import asyncio
import httpx
import os
import subprocess

async def test_api():
    print("Testing Video to MP3 backend API with new features...")
    from app import app

    # Create 1 valid video with audio and 1 video WITHOUT audio stream
    subprocess.run([
        "ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=30",
        "-f", "lavfi", "-i", "sine=frequency=1000:duration=2",
        "-c:v", "libx264", "-c:a", "aac", "-shortest", "test_with_audio.mp4"
    ], capture_output=True, check=True)

    subprocess.run([
        "ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=30",
        "-c:v", "libx264", "-an", "test_no_audio.mp4"
    ], capture_output=True, check=True)

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        # 1. Test GET /
        res = await client.get("/")
        assert res.status_code == 200
        print("✓ GET / (HTML rendered)")

        # 2. Test GET and POST /api/settings (Custom folder)
        custom_folder = os.path.abspath("test_custom_output")
        set_res = await client.post("/api/settings", json={"output_dir": custom_folder})
        assert set_res.status_code == 200
        assert os.path.exists(custom_folder)
        print(f"✓ POST /api/settings (Custom folder set to: {custom_folder})")

        # 3. Test Upload both files
        with open("test_with_audio.mp4", "rb") as f1, open("test_no_audio.mp4", "rb") as f2:
            files = [
                ("files", ("test_with_audio.mp4", f1, "video/mp4")),
                ("files", ("test_no_audio.mp4", f2, "video/mp4")),
            ]
            up_res = await client.post("/api/upload", files=files)
            assert up_res.status_code == 200
            up_data = up_res.json()
            assert len(up_data["tasks"]) == 2
            print("✓ POST /api/upload (Uploaded valid video + no-audio video)")

        task_audio_id = up_data["tasks"][0]["id"]
        task_no_audio_id = up_data["tasks"][1]["id"]

        # 4. Convert valid video
        c_res = await client.post(f"/api/convert/{task_audio_id}", json={
            "bitrate": "192k",
            "sample_rate": "44100",
            "channels": "2",
            "volume_effect": "none"
        })
        assert c_res.status_code == 200

        for _ in range(20):
            await asyncio.sleep(0.5)
            st = (await client.get(f"/api/status/{task_audio_id}")).json()
            if st["status"] == "completed":
                print(f"✓ Video with audio completed! Saved at: {st['output_path']}")
                assert os.path.exists(st["output_path"])
                assert "test_custom_output" in st["output_path"]
                break
        assert st["status"] == "completed"

        # 5. Convert video WITHOUT audio - should detect and return clear error
        c2_res = await client.post(f"/api/convert/{task_no_audio_id}", json={
            "bitrate": "192k",
            "sample_rate": "44100",
            "channels": "2",
            "volume_effect": "none"
        })
        assert c2_res.status_code == 200

        for _ in range(10):
            await asyncio.sleep(0.3)
            st2 = (await client.get(f"/api/status/{task_no_audio_id}")).json()
            if st2["status"] == "error":
                print(f"✓ Video with NO audio properly failed with clear error message:\n  -> '{st2['error']}'")
                break
        assert st2["status"] == "error"
        assert "tidak memiliki trek" in st2["error"]

        # 6. Test clear all
        await client.post("/api/clear")
        print("✓ POST /api/clear")

    # Cleanup temp test files
    for f in ["test_with_audio.mp4", "test_no_audio.mp4"]:
        if os.path.exists(f):
            os.remove(f)
    if os.path.exists(custom_folder):
        import shutil
        shutil.rmtree(custom_folder, ignore_errors=True)

    print("\nALL ENHANCED TESTS PASSED PERFECTLY! 🎉")

if __name__ == "__main__":
    asyncio.run(test_api())
