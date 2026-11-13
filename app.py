import os
import shutil
import uuid
import time
import asyncio
import zipfile
import subprocess
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks, Request
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
DEFAULT_CONVERTED_DIR = BASE_DIR / "converted"

UPLOAD_DIR.mkdir(exist_ok=True)
DEFAULT_CONVERTED_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Video to MP3 Converter Web App", version="1.2.0")

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

# Global Settings
app_settings = {
    "output_dir": str(DEFAULT_CONVERTED_DIR)
}

# Task store: task_id -> task_data dict
tasks: Dict[str, dict] = {}
conversion_semaphore = asyncio.Semaphore(3)  # Max 3 parallel ffmpeg processes


def has_audio_stream(file_path: str) -> bool:
    """Check if the media file contains at least one audio stream."""
    try:
        cmd = [
            "ffprobe", "-v", "error",
            "-select_streams", "a",
            "-show_entries", "stream=codec_name",
            "-of", "csv=p=0",
            str(file_path)
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        return bool(res.stdout.strip())
    except Exception as e:
        print(f"Warning checking audio stream: {e}")
        return True  # Fallback to attempting conversion


def get_media_duration(file_path: str) -> float:
    """Extract duration in seconds using ffprobe."""
    try:
        cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(file_path)
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if res.returncode == 0 and res.stdout.strip():
            return float(res.stdout.strip())
    except Exception as e:
        print(f"Error reading duration: {e}")
    return 0.0


def format_file_size(size_bytes: int) -> str:
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    elif size_bytes < 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    else:
        return f"{size_bytes / (1024 * 1024 * 1024):.2f} GB"


def format_duration(seconds: float) -> str:
    if seconds <= 0:
        return "Unknown"
    mins, secs = divmod(int(seconds), 60)
    hours, mins = divmod(mins, 60)
    if hours > 0:
        return f"{hours:02d}:{mins:02d}:{secs:02d}"
    return f"{mins:02d}:{secs:02d}"


async def run_ffmpeg_conversion(
    task_id: str,
    bitrate: str = "192k",
    sample_rate: str = "44100",
    channels: str = "2",
    volume_effect: str = "none",
    target_output_dir: Optional[str] = None
):
    async with conversion_semaphore:
        task = tasks.get(task_id)
        if not task:
            return

        task["status"] = "converting"
        task["progress"] = 0
        task["speed"] = ""
        task["error"] = None

        input_path = task["input_path"]

        # 1. Check if file has an audio stream
        if not has_audio_stream(input_path):
            task["status"] = "error"
            task["error"] = "File video ini tidak memiliki trek suara/audio (No audio stream). Tidak ada audio untuk diekstrak."
            return

        # Determine target directory
        out_dir = Path(target_output_dir) if target_output_dir else Path(app_settings["output_dir"])
        try:
            out_dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            task["status"] = "error"
            task["error"] = f"Tidak dapat membuat folder output: {e}"
            return

        clean_stem = Path(task['original_filename']).stem
        output_filename = f"{clean_stem}.mp3"
        output_path = str(out_dir / output_filename)
        
        # If output file already exists, create unique name
        if os.path.exists(output_path):
            output_filename = f"{clean_stem}_{task_id[:6]}.mp3"
            output_path = str(out_dir / output_filename)

        task["output_path"] = output_path
        task["output_filename"] = output_filename
        task["output_directory"] = str(out_dir)

        total_duration = task["duration"]
        if total_duration <= 0:
            total_duration = get_media_duration(input_path)
            task["duration"] = total_duration

        # Build robust ffmpeg command
        cmd = [
            "ffmpeg", "-y",
            "-fflags", "+genpts",
            "-i", input_path,
            "-vn",
            "-map", "0:a:0",
            "-c:a", "libmp3lame",
            "-b:a", bitrate,
            "-ar", sample_rate,
            "-ac", channels,
            "-threads", "0",
        ]

        if volume_effect == "loudnorm":
            cmd.extend(["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"])
        elif volume_effect == "boost_3db":
            cmd.extend(["-af", "volume=3dB"])
        elif volume_effect == "boost_6db":
            cmd.extend(["-af", "volume=6dB"])

        cmd.extend([
            "-avoid_negative_ts", "make_zero",
            "-progress", "pipe:1",
            "-nostats",
            output_path
        ])

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )

            # Concurrently drain stderr to avoid OS pipe deadlock
            stderr_lines: List[str] = []

            async def drain_stderr():
                while True:
                    err_line = await process.stderr.readline()
                    if not err_line:
                        break
                    decoded = err_line.decode("utf-8", errors="ignore").strip()
                    if decoded:
                        stderr_lines.append(decoded)

            stderr_task = asyncio.create_task(drain_stderr())

            current_time = 0.0
            while True:
                line = await process.stdout.readline()
                if not line:
                    break
                line_str = line.decode("utf-8", errors="ignore").strip()

                if line_str.startswith("out_time_us="):
                    val = line_str.split("=")[1]
                    try:
                        current_time = float(val) / 1000000.0
                    except ValueError:
                        pass
                elif line_str.startswith("out_time_ms="):
                    val = line_str.split("=")[1]
                    try:
                        current_time = float(val) / 1000.0
                    except ValueError:
                        pass
                elif line_str.startswith("speed="):
                    task["speed"] = line_str.split("=")[1].strip()
                elif line_str.startswith("progress="):
                    prog_state = line_str.split("=")[1].strip()
                    if prog_state == "end":
                        task["progress"] = 100

                if total_duration > 0 and task["status"] == "converting":
                    pct = min(99.0, (current_time / total_duration) * 100.0)
                    task["progress"] = max(task["progress"], round(pct, 1))

            await process.wait()
            await stderr_task

            if process.returncode == 0 and os.path.exists(output_path):
                task["status"] = "completed"
                task["progress"] = 100.0
                out_size = os.path.getsize(output_path)
                task["output_size"] = out_size
                task["output_size_formatted"] = format_file_size(out_size)
            else:
                # Find informative error line from stderr
                err_detail = "Kesalahan encoding FFmpeg."
                for l in reversed(stderr_lines):
                    if any(kw in l.lower() for kw in ["error", "invalid", "failed", "cannot", "does not contain"]):
                        err_detail = l
                        break
                if err_detail == "Kesalahan encoding FFmpeg." and stderr_lines:
                    err_detail = "\n".join(stderr_lines[-3:])

                task["status"] = "error"
                task["error"] = err_detail
        except asyncio.CancelledError:
            task["status"] = "error"
            task["error"] = "Proses konversi dihentikan atau server di-reload."
            raise
        except Exception as e:
            task["status"] = "error"
            task["error"] = str(e) or "Terjadi kesalahan internal saat menjalankan FFmpeg."


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")


@app.get("/api/settings")
async def get_settings():
    return JSONResponse(app_settings)


class SettingsUpdate(BaseModel):
    output_dir: str


@app.post("/api/settings")
async def update_settings(data: SettingsUpdate):
    target = Path(data.output_dir.strip())
    try:
        target.mkdir(parents=True, exist_ok=True)
        app_settings["output_dir"] = str(target.resolve())
        return JSONResponse({"status": "success", "output_dir": app_settings["output_dir"]})
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Folder tidak valid atau tidak dapat diakses: {str(e)}")


def _ask_folder_gui():
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk()
    root.withdraw()
    root.wm_attributes('-topmost', 1)
    folder = filedialog.askdirectory(
        title="Pilih Folder Penyimpanan Hasil Convert MP3",
        initialdir=app_settings["output_dir"]
    )
    root.destroy()
    return folder


@app.post("/api/choose-folder")
async def choose_folder_gui():
    try:
        selected_folder = await asyncio.to_thread(_ask_folder_gui)
        if selected_folder:
            norm_folder = str(Path(selected_folder).resolve())
            app_settings["output_dir"] = norm_folder
            return JSONResponse({"status": "success", "folder": norm_folder})
        return JSONResponse({"status": "cancelled", "folder": app_settings["output_dir"]})
    except Exception as e:
        return JSONResponse({"status": "error", "message": str(e), "folder": app_settings["output_dir"]})


class OpenFolderRequest(BaseModel):
    folder: Optional[str] = None


@app.post("/api/open-folder")
async def open_in_explorer(req: OpenFolderRequest):
    folder_to_open = req.folder if req.folder else app_settings["output_dir"]
    target_path = Path(folder_to_open)
    if not target_path.exists():
        target_path.mkdir(parents=True, exist_ok=True)

    try:
        os.startfile(str(target_path))
        return JSONResponse({"status": "opened", "path": str(target_path)})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gagal membuka folder di Explorer: {str(e)}")


@app.post("/api/show-in-folder/{task_id}")
async def show_file_in_explorer(task_id: str):
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task tidak ditemukan")
    task = tasks[task_id]
    if not task.get("output_path") or not os.path.exists(task["output_path"]):
        raise HTTPException(status_code=404, detail="File MP3 belum tersedia di penyimpanan")

    try:
        norm_path = os.path.normpath(task["output_path"])
        subprocess.Popen(["explorer", f"/select,{norm_path}"])
        return JSONResponse({"status": "selected", "path": norm_path})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gagal membuka lokasi file: {str(e)}")


@app.post("/api/upload")
async def upload_files(files: List[UploadFile] = File(...)):
    new_tasks = []
    for file in files:
        task_id = uuid.uuid4().hex[:10]
        ext = Path(file.filename).suffix.lower()
        save_name = f"{task_id}_{file.filename}"
        input_path = UPLOAD_DIR / save_name

        with open(input_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        file_size = os.path.getsize(input_path)
        duration = get_media_duration(str(input_path))

        task_data = {
            "id": task_id,
            "original_filename": file.filename,
            "extension": ext,
            "input_path": str(input_path),
            "output_path": None,
            "output_filename": None,
            "output_directory": app_settings["output_dir"],
            "file_size": file_size,
            "file_size_formatted": format_file_size(file_size),
            "duration": duration,
            "duration_formatted": format_duration(duration),
            "status": "ready",
            "progress": 0.0,
            "speed": "",
            "output_size": 0,
            "output_size_formatted": "-",
            "error": None,
            "created_at": time.time()
        }
        tasks[task_id] = task_data
        new_tasks.append(task_data)

    return JSONResponse(content={"status": "success", "tasks": new_tasks})


class ConvertOptions(BaseModel):
    bitrate: Optional[str] = "192k"
    sample_rate: Optional[str] = "44100"
    channels: Optional[str] = "2"
    volume_effect: Optional[str] = "none"
    output_dir: Optional[str] = None


@app.post("/api/convert/{task_id}")
async def convert_single(task_id: str, options: ConvertOptions, background_tasks: BackgroundTasks):
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")

    task = tasks[task_id]
    if task["status"] == "converting":
        return JSONResponse({"status": "already_converting", "task": task})

    target_dir = options.output_dir or app_settings["output_dir"]
    background_tasks.add_task(
        run_ffmpeg_conversion,
        task_id=task_id,
        bitrate=options.bitrate,
        sample_rate=options.sample_rate,
        channels=options.channels,
        volume_effect=options.volume_effect,
        target_output_dir=target_dir
    )
    task["status"] = "converting"
    task["progress"] = 0
    return JSONResponse({"status": "started", "task_id": task_id})


class BatchConvertRequest(BaseModel):
    task_ids: List[str]
    bitrate: Optional[str] = "192k"
    sample_rate: Optional[str] = "44100"
    channels: Optional[str] = "2"
    volume_effect: Optional[str] = "none"
    output_dir: Optional[str] = None


@app.post("/api/convert-batch")
async def convert_batch(req: BatchConvertRequest, background_tasks: BackgroundTasks):
    valid_ids = [tid for tid in req.task_ids if tid in tasks]
    if not valid_ids:
        raise HTTPException(status_code=400, detail="No valid tasks provided")

    target_dir = req.output_dir or app_settings["output_dir"]

    for tid in valid_ids:
        task = tasks[tid]
        if task["status"] != "converting":
            task["status"] = "queued"
            task["progress"] = 0
            background_tasks.add_task(
                run_ffmpeg_conversion,
                task_id=tid,
                bitrate=req.bitrate,
                sample_rate=req.sample_rate,
                channels=req.channels,
                volume_effect=req.volume_effect,
                target_output_dir=target_dir
            )

    return JSONResponse({"status": "batch_started", "queued_count": len(valid_ids)})


@app.get("/api/status/{task_id}")
async def get_task_status(task_id: str):
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    return JSONResponse(tasks[task_id])


@app.get("/api/tasks")
async def get_all_tasks():
    return JSONResponse(list(tasks.values()))


@app.get("/api/download/{task_id}")
async def download_file(task_id: str):
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    task = tasks[task_id]
    if task["status"] != "completed" or not task.get("output_path") or not os.path.exists(task["output_path"]):
        raise HTTPException(status_code=400, detail="File is not ready for download")

    return FileResponse(
        path=task["output_path"],
        filename=task["output_filename"],
        media_type="audio/mpeg"
    )


@app.get("/api/preview/{task_id}")
async def preview_audio(task_id: str):
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    task = tasks[task_id]
    if task["status"] != "completed" or not task.get("output_path") or not os.path.exists(task["output_path"]):
        raise HTTPException(status_code=400, detail="File not ready for preview")

    return FileResponse(
        path=task["output_path"],
        media_type="audio/mpeg",
        headers={"Accept-Ranges": "bytes"}
    )


class BatchDownloadRequest(BaseModel):
    task_ids: List[str]


@app.post("/api/download-zip")
async def download_zip(req: BatchDownloadRequest):
    completed_tasks = [
        tasks[tid] for tid in req.task_ids 
        if tid in tasks and tasks[tid]["status"] == "completed" and tasks[tid].get("output_path") and os.path.exists(tasks[tid]["output_path"])
    ]

    if not completed_tasks:
        raise HTTPException(status_code=400, detail="No completed files found for zip")

    zip_filename = f"converted_mp3_{int(time.time())}.zip"
    zip_path = DEFAULT_CONVERTED_DIR / zip_filename

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for t in completed_tasks:
            arcname = t["output_filename"]
            zip_file.write(t["output_path"], arcname=arcname)

    return FileResponse(
        path=str(zip_path),
        filename=zip_filename,
        media_type="application/zip"
    )


@app.delete("/api/task/{task_id}")
async def delete_task(task_id: str):
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")

    task = tasks.pop(task_id)
    if task.get("input_path") and os.path.exists(task["input_path"]):
        try:
            os.remove(task["input_path"])
        except Exception:
            pass

    return JSONResponse({"status": "deleted", "task_id": task_id})


@app.post("/api/clear")
async def clear_all_tasks():
    cleared_count = len(tasks)
    for tid, task in list(tasks.items()):
        if task.get("input_path") and os.path.exists(task["input_path"]):
            try:
                os.remove(task["input_path"])
            except Exception:
                pass
    tasks.clear()
    return JSONResponse({"status": "cleared", "count": cleared_count})


if __name__ == "__main__":
    import uvicorn
    print("=" * 60)
    print(" Video to MP3 Converter Web App")
    print(f" Folder Hasil Default: {app_settings['output_dir']}")
    print(" Buka web browser Anda di: http://localhost:8000")
    print("=" * 60)
    # reload=False to prevent accidental cancellation during conversion
    uvicorn.run(app, host="0.0.0.0", port=8000)
