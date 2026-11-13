/**
 * Video to MP3 Studio - Client Application Logic
 */

document.addEventListener('DOMContentLoaded', () => {
    // State
    const tasks = new Map();
    let pollInterval = null;
    let isConvertingBatch = false;
    let currentOutputDir = '';

    // DOM Elements
    const dropzone = document.getElementById('dropzone');
    const dragOverlay = document.getElementById('dragOverlay');
    const fileInput = document.getElementById('fileInput');
    const tasksContainer = document.getElementById('tasksContainer');
    const emptyPlaceholder = document.getElementById('emptyPlaceholder');
    const toolbarSection = document.getElementById('toolbarSection');
    const statsTotal = document.getElementById('statsTotal');
    const statsCompleted = document.getElementById('statsCompleted');
    const btnConvertAll = document.getElementById('btnConvertAll');
    const btnDownloadZip = document.getElementById('btnDownloadZip');
    const btnClearAll = document.getElementById('btnClearAll');

    // Import / Upload Progress Elements
    const importProgressSection = document.getElementById('importProgressSection');
    const importCounterBadge = document.getElementById('importCounterBadge');
    const importCurrentFilename = document.getElementById('importCurrentFilename');
    const importPercentText = document.getElementById('importPercentText');
    const importSpeedText = document.getElementById('importSpeedText');
    const importProgressBar = document.getElementById('importProgressBar');
    const importSizeProgress = document.getElementById('importSizeProgress');
    const importStatusText = document.getElementById('importStatusText');

    // Folder Destination Elements
    const outputFolderInput = document.getElementById('outputFolderInput');
    const btnBrowseFolder = document.getElementById('btnBrowseFolder');
    const btnOpenFolder = document.getElementById('btnOpenFolder');
    const btnSaveOutputFolder = document.getElementById('btnSaveOutputFolder');
    const folderFeedback = document.getElementById('folderFeedback');

    // Settings Elements
    const settingsToggleHeader = document.getElementById('settingsToggleHeader');
    const settingsBody = document.getElementById('settingsBody');
    const settingsChevron = document.getElementById('settingsChevron');
    const settingsSummary = document.getElementById('settingsSummary');
    const settingBitrate = document.getElementById('settingBitrate');
    const settingSampleRate = document.getElementById('settingSampleRate');
    const settingChannels = document.getElementById('settingChannels');
    const settingVolume = document.getElementById('settingVolume');

    // Audio Player Elements
    const audioPlayerBar = document.getElementById('audioPlayerBar');
    const globalAudio = document.getElementById('globalAudio');
    const playerTrackTitle = document.getElementById('playerTrackTitle');
    const playerTrackInfo = document.getElementById('playerTrackInfo');
    const playerPlayBtn = document.getElementById('playerPlayBtn');
    const playerPlayIcon = document.getElementById('playerPlayIcon');
    const playerSeekBar = document.getElementById('playerSeekBar');
    const playerCurrentTime = document.getElementById('playerCurrentTime');
    const playerDuration = document.getElementById('playerDuration');
    const playerVolume = document.getElementById('playerVolume');
    const playerCloseBtn = document.getElementById('playerCloseBtn');
    const playerRewindBtn = document.getElementById('playerRewindBtn');
    const playerForwardBtn = document.getElementById('playerForwardBtn');

    let currentPlayingTaskId = null;

    // --- Init: Fetch Current Settings ---
    async function loadSettings() {
        try {
            const res = await fetch('/api/settings');
            if (res.ok) {
                const data = await res.json();
                currentOutputDir = data.output_dir || '';
                outputFolderInput.value = currentOutputDir;
            }
        } catch (err) {
            console.error('Failed to load settings:', err);
        }
    }
    loadSettings();

    // --- Folder Destination Handlers ---
    btnBrowseFolder.addEventListener('click', async () => {
        btnBrowseFolder.disabled = true;
        const originalText = btnBrowseFolder.innerHTML;
        btnBrowseFolder.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Membuka Dialog...</span>`;
        if (window.lucide) lucide.createIcons();

        try {
            const res = await fetch('/api/choose-folder', { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                if (data.folder) {
                    currentOutputDir = data.folder;
                    outputFolderInput.value = currentOutputDir;
                    showFolderFeedback('Folder berhasil dipilih: ' + currentOutputDir);
                }
            }
        } catch (err) {
            console.error('Error choosing folder:', err);
        } finally {
            btnBrowseFolder.disabled = false;
            btnBrowseFolder.innerHTML = originalText;
            if (window.lucide) lucide.createIcons();
        }
    });

    btnSaveOutputFolder.addEventListener('click', async () => {
        const val = outputFolderInput.value.trim();
        if (!val) return;

        try {
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ output_dir: val })
            });

            if (res.ok) {
                const data = await res.json();
                currentOutputDir = data.output_dir;
                outputFolderInput.value = currentOutputDir;
                showFolderFeedback('Folder penyimpanan berhasil disimpan!');
            } else {
                const err = await res.json();
                alert('Gagal: ' + (err.detail || 'Folder tidak valid'));
            }
        } catch (err) {
            alert('Kesalahan jaringan: ' + err.message);
        }
    });

    btnOpenFolder.addEventListener('click', async () => {
        try {
            const res = await fetch('/api/open-folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folder: outputFolderInput.value.trim() || currentOutputDir })
            });
            if (!res.ok) {
                const err = await res.json();
                alert('Gagal membuka folder: ' + err.detail);
            }
        } catch (err) {
            console.error('Error opening folder:', err);
        }
    });

    function showFolderFeedback(msg) {
        folderFeedback.innerHTML = `<i data-lucide="check" class="w-3 h-3"></i> <span>${escapeHtml(msg)}</span>`;
        folderFeedback.classList.remove('hidden');
        if (window.lucide) lucide.createIcons();
        setTimeout(() => {
            folderFeedback.classList.add('hidden');
        }, 3500);
    }

    // --- Settings Toggle & Summary ---
    function updateSettingsSummary() {
        const bitrate = settingBitrate.value.toUpperCase();
        const srate = (parseInt(settingSampleRate.value) / 1000).toFixed(1) + ' kHz';
        const ch = settingChannels.value === '2' ? 'Stereo' : 'Mono';
        const vol = settingVolume.value !== 'none' ? ' · ' + settingVolume.options[settingVolume.selectedIndex].text : '';
        settingsSummary.textContent = `${bitrate} · ${srate} · ${ch}${vol}`;
    }

    [settingBitrate, settingSampleRate, settingChannels, settingVolume].forEach(el => {
        el.addEventListener('change', updateSettingsSummary);
    });

    settingsToggleHeader.addEventListener('click', () => {
        const isHidden = settingsBody.classList.toggle('hidden');
        settingsChevron.style.transform = isHidden ? 'rotate(-90deg)' : 'rotate(0deg)';
    });

    function getConversionOptions() {
        return {
            bitrate: settingBitrate.value,
            sample_rate: settingSampleRate.value,
            channels: settingChannels.value,
            volume_effect: settingVolume.value,
            output_dir: outputFolderInput.value.trim() || currentOutputDir
        };
    }

    // --- Drag and Drop Handlers ---
    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dragOverlay.classList.remove('opacity-0');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dragOverlay.classList.add('opacity-0');
        }, false);
    });

    dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            handleFilesUpload(files);
        }
    });

    dropzone.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            handleFilesUpload(fileInput.files);
            fileInput.value = ''; // Reset input so same file can be selected again
        }
    });

    // --- Helper for Bytes Formatting ---
    function formatBytes(bytes) {
        if (isNaN(bytes) || bytes < 0) return '0 B';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }

    // --- Upload Single File with Real-Time Byte Progress ---
    function uploadSingleFile(file, onProgress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const formData = new FormData();
            formData.append('files', file);

            let lastTime = Date.now();
            let lastLoaded = 0;

            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const now = Date.now();
                    const dt = (now - lastTime) / 1000;
                    let speed = 0;
                    if (dt >= 0.2) {
                        speed = (e.loaded - lastLoaded) / dt;
                        lastTime = now;
                        lastLoaded = e.loaded;
                    }
                    onProgress(e.loaded, e.total, speed);
                }
            });

            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        resolve(data);
                    } catch (err) {
                        reject(new Error('Format respons server tidak valid'));
                    }
                } else {
                    reject(new Error(`Gagal mengunggah (${xhr.status})`));
                }
            });

            xhr.addEventListener('error', () => reject(new Error('Koneksi terputus saat mengunggah')));
            xhr.addEventListener('abort', () => reject(new Error('Unggahan dibatalkan')));

            xhr.open('POST', '/api/upload');
            xhr.send(formData);
        });
    }

    // --- Upload Handlers with Live Batch Progress ---
    async function handleFilesUpload(fileList) {
        const files = Array.from(fileList);
        if (files.length === 0) return;

        const totalAllBytes = files.reduce((sum, f) => sum + f.size, 0);

        // Show progress overlay
        importProgressSection.classList.remove('hidden');
        dropzone.classList.add('opacity-40', 'pointer-events-none');
        importProgressBar.style.width = '0%';
        importPercentText.textContent = '0%';
        importSpeedText.textContent = '0 MB/s';
        importSizeProgress.textContent = `0 B / ${formatBytes(totalAllBytes)}`;
        if (window.lucide) lucide.createIcons();

        let completedBytesBefore = 0;
        let failedFiles = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            importCounterBadge.textContent = `${i + 1} / ${files.length} File`;
            importCurrentFilename.textContent = `${file.name} (${formatBytes(file.size)})`;
            importStatusText.textContent = `Mengimpor ke antrean (${i + 1} dari ${files.length})...`;

            try {
                const data = await uploadSingleFile(file, (loaded, total, speedBytesPerSec) => {
                    const overallLoaded = completedBytesBefore + loaded;
                    const overallPct = Math.min(99, Math.round((overallLoaded / totalAllBytes) * 100));
                    importProgressBar.style.width = `${overallPct}%`;
                    importPercentText.textContent = `${overallPct}%`;
                    importSizeProgress.textContent = `${formatBytes(overallLoaded)} / ${formatBytes(totalAllBytes)}`;
                    if (speedBytesPerSec > 0) {
                        importSpeedText.textContent = `${(speedBytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
                    }
                });

                if (data.status === 'success' && data.tasks) {
                    data.tasks.forEach(t => {
                        tasks.set(t.id, t);
                    });
                    // Immediately show new file on the page!
                    renderTaskList();
                }
            } catch (err) {
                console.error(`Error uploading ${file.name}:`, err);
                failedFiles.push(file.name);
            }

            completedBytesBefore += file.size;
        }

        // All finished
        importProgressBar.style.width = '100%';
        importPercentText.textContent = '100%';
        importSizeProgress.textContent = `${formatBytes(totalAllBytes)} / ${formatBytes(totalAllBytes)}`;
        importSpeedText.textContent = 'Selesai';
        importStatusText.textContent = failedFiles.length === 0 
            ? `✅ Selesai! ${files.length} file berhasil diimpor ke antrean.`
            : `⚠️ ${files.length - failedFiles.length} file berhasil, ${failedFiles.length} gagal diimpor.`;

        setTimeout(() => {
            importProgressSection.classList.add('hidden');
            dropzone.classList.remove('opacity-40', 'pointer-events-none');
            importProgressBar.style.width = '0%';
            importPercentText.textContent = '0%';
        }, 1500);
    }

    // --- Task Rendering ---
    function renderTaskList() {
        const taskArray = Array.from(tasks.values());

        if (taskArray.length === 0) {
            emptyPlaceholder.classList.remove('hidden');
            toolbarSection.classList.add('hidden');
            return;
        }

        emptyPlaceholder.classList.add('hidden');
        toolbarSection.classList.remove('hidden');

        // Update stats
        const completedCount = taskArray.filter(t => t.status === 'completed').length;
        statsTotal.textContent = `${taskArray.length} File`;
        if (completedCount > 0) {
            statsCompleted.textContent = `${completedCount} Selesai`;
            statsCompleted.classList.remove('hidden');
            btnDownloadZip.classList.remove('hidden');
        } else {
            statsCompleted.classList.add('hidden');
            btnDownloadZip.classList.add('hidden');
        }

        // Render each task card
        taskArray.forEach(task => {
            let el = document.getElementById(`task-card-${task.id}`);
            if (!el) {
                el = createTaskCardElement(task);
                tasksContainer.appendChild(el);
            } else {
                updateTaskCardElement(el, task);
            }
        });

        // Remove cards that are no longer in tasks map
        const existingCards = tasksContainer.querySelectorAll('.task-card');
        existingCards.forEach(card => {
            const id = card.dataset.taskId;
            if (!tasks.has(id)) {
                card.remove();
            }
        });

        if (window.lucide) {
            lucide.createIcons();
        }
    }

    function createTaskCardElement(task) {
        const card = document.createElement('div');
        card.id = `task-card-${task.id}`;
        card.dataset.taskId = task.id;
        card.className = 'task-card bg-slate-900/70 border border-slate-800 rounded-xl p-4 transition-all duration-200';

        card.innerHTML = `
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <!-- File Meta -->
                <div class="flex items-start space-x-3 min-w-0 flex-1">
                    <div class="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 flex-shrink-0 mt-0.5">
                        <i data-lucide="video" class="w-5 h-5"></i>
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center space-x-2">
                            <h4 class="text-sm font-semibold text-slate-100 truncate" title="${escapeHtml(task.original_filename)}">
                                ${escapeHtml(task.original_filename)}
                            </h4>
                            <span class="px-1.5 py-0.5 text-[10px] uppercase font-mono font-bold bg-slate-800 text-emerald-400 rounded border border-slate-700 flex-shrink-0">
                                ${task.extension ? task.extension.replace('.', '') : 'VIDEO'}
                            </span>
                        </div>
                        <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-400 mt-1">
                            <span>Ukuran: <b class="text-slate-300">${task.file_size_formatted}</b></span>
                            <span>·</span>
                            <span>Durasi: <b class="text-slate-300">${task.duration_formatted}</b></span>
                            <span class="output-size-tag hidden text-emerald-400">· MP3: <b>${task.output_size_formatted || ''}</b></span>
                        </div>
                    </div>
                </div>

                <!-- Status Badge & Action Buttons -->
                <div class="flex items-center space-x-2 self-end sm:self-center flex-shrink-0">
                    <!-- Status Badge -->
                    <div class="status-badge px-2.5 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 bg-slate-800 text-slate-400 border border-slate-700">
                        <span class="status-dot w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                        <span class="status-text">Siap</span>
                    </div>

                    <!-- Convert Single Button -->
                    <button class="btn-convert-single px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-semibold flex items-center gap-1 transition" title="Konversi video ini">
                        <i data-lucide="play" class="w-3.5 h-3.5"></i>
                        <span>Konversi</span>
                    </button>

                    <!-- Play Audio Button (Completed only) -->
                    <button class="btn-preview-audio hidden p-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 rounded-lg transition" title="Dengarkan MP3">
                        <i data-lucide="play" class="w-4 h-4 fill-indigo-400"></i>
                    </button>

                    <!-- Open File in Explorer Button (Completed only) -->
                    <button class="btn-show-folder hidden p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg transition" title="Buka dan tandai file di Windows Explorer">
                        <i data-lucide="folder" class="w-4 h-4 text-emerald-400"></i>
                    </button>

                    <!-- Download Single Button (Completed only) -->
                    <a class="btn-download-single hidden px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg text-xs flex items-center gap-1 shadow-md shadow-emerald-500/20 transition" download>
                        <i data-lucide="download" class="w-3.5 h-3.5"></i>
                        <span>Download</span>
                    </a>

                    <!-- Delete Button -->
                    <button class="btn-delete-task p-1.5 hover:bg-red-500/10 text-slate-400 hover:text-red-400 rounded-lg transition" title="Hapus dari daftar">
                        <i data-lucide="x" class="w-4 h-4"></i>
                    </button>
                </div>
            </div>

            <!-- Progress Bar Section (Visible when converting/queued) -->
            <div class="progress-section hidden mt-3 pt-2 border-t border-slate-800/60">
                <div class="flex items-center justify-between text-xs text-slate-400 mb-1">
                    <span class="progress-label">Mengonversi...</span>
                    <span class="progress-percentage font-mono text-emerald-400 font-bold">0%</span>
                </div>
                <div class="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div class="progress-bar bg-gradient-to-r from-emerald-500 to-teal-400 h-1.5 rounded-full transition-all duration-300 w-0 progress-animated"></div>
                </div>
            </div>

            <!-- Output Path Info (Completed only) -->
            <div class="output-path-section hidden mt-2 text-[11px] text-slate-400 bg-slate-950/50 border border-slate-800/80 rounded-md p-2 flex items-center justify-between gap-2">
                <div class="truncate flex items-center gap-1.5">
                    <i data-lucide="check-circle-2" class="w-3.5 h-3.5 text-emerald-400 flex-shrink-0"></i>
                    <span class="text-slate-500">Tersimpan di:</span>
                    <span class="output-path-text font-mono text-emerald-300 truncate"></span>
                </div>
            </div>

            <!-- Error message container -->
            <div class="error-section hidden mt-2 text-xs text-red-300 bg-red-950/40 border border-red-500/30 rounded-md p-2.5 space-y-1">
                <div class="flex items-center gap-1.5 font-semibold text-red-400">
                    <i data-lucide="alert-triangle" class="w-4 h-4 flex-shrink-0"></i>
                    <span>Gagal Dikonversi</span>
                </div>
                <p class="error-text font-mono text-[11px] text-red-300 break-words whitespace-pre-wrap"></p>
            </div>
        `;

        // Attach event listeners
        const btnConvert = card.querySelector('.btn-convert-single');
        btnConvert.addEventListener('click', () => convertSingle(task.id));

        const btnPreview = card.querySelector('.btn-preview-audio');
        btnPreview.addEventListener('click', () => playAudioPreview(task.id));

        const btnShowFolder = card.querySelector('.btn-show-folder');
        btnShowFolder.addEventListener('click', () => showInFolder(task.id));

        const btnDelete = card.querySelector('.btn-delete-task');
        btnDelete.addEventListener('click', () => deleteTask(task.id));

        updateTaskCardElement(card, task);
        return card;
    }

    function updateTaskCardElement(card, task) {
        const badge = card.querySelector('.status-badge');
        const dot = card.querySelector('.status-dot');
        const text = card.querySelector('.status-text');
        const btnConvert = card.querySelector('.btn-convert-single');
        const btnPreview = card.querySelector('.btn-preview-audio');
        const btnShowFolder = card.querySelector('.btn-show-folder');
        const btnDownload = card.querySelector('.btn-download-single');
        const progressSection = card.querySelector('.progress-section');
        const progressBar = card.querySelector('.progress-bar');
        const progressPercentage = card.querySelector('.progress-percentage');
        const progressLabel = card.querySelector('.progress-label');
        const outputPathSection = card.querySelector('.output-path-section');
        const outputPathText = card.querySelector('.output-path-text');
        const errorSection = card.querySelector('.error-section');
        const errorText = card.querySelector('.error-text');
        const outputSizeTag = card.querySelector('.output-size-tag');

        // Reset badge classes
        badge.className = 'status-badge px-2.5 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 border';

        if (task.status === 'ready') {
            badge.classList.add('bg-slate-800', 'text-slate-400', 'border-slate-700');
            dot.className = 'status-dot w-1.5 h-1.5 rounded-full bg-slate-400';
            text.textContent = 'Siap';
            btnConvert.classList.remove('hidden');
            btnPreview.classList.add('hidden');
            btnShowFolder.classList.add('hidden');
            btnDownload.classList.add('hidden');
            progressSection.classList.add('hidden');
            outputPathSection.classList.add('hidden');
            errorSection.classList.add('hidden');
            outputSizeTag.classList.add('hidden');
        } else if (task.status === 'queued') {
            badge.classList.add('bg-amber-500/10', 'text-amber-400', 'border-amber-500/20');
            dot.className = 'status-dot w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping';
            text.textContent = 'Antrean';
            btnConvert.classList.add('hidden');
            btnPreview.classList.add('hidden');
            btnShowFolder.classList.add('hidden');
            btnDownload.classList.add('hidden');
            progressSection.classList.remove('hidden');
            progressLabel.textContent = 'Menunggu giliran...';
            progressBar.style.width = '5%';
            progressPercentage.textContent = '...';
            outputPathSection.classList.add('hidden');
            errorSection.classList.add('hidden');
        } else if (task.status === 'converting') {
            badge.classList.add('bg-emerald-500/10', 'text-emerald-400', 'border-emerald-500/20');
            dot.className = 'status-dot w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse';
            text.textContent = task.speed ? `Mengonversi (${task.speed})` : 'Mengonversi...';
            btnConvert.classList.add('hidden');
            btnPreview.classList.add('hidden');
            btnShowFolder.classList.add('hidden');
            btnDownload.classList.add('hidden');
            progressSection.classList.remove('hidden');
            progressLabel.textContent = task.speed ? `Proses encode (${task.speed})` : 'Mengonversi...';
            const pct = Math.max(0, Math.min(100, task.progress || 0));
            progressBar.style.width = `${pct}%`;
            progressPercentage.textContent = `${pct}%`;
            outputPathSection.classList.add('hidden');
            errorSection.classList.add('hidden');
        } else if (task.status === 'completed') {
            badge.classList.add('bg-emerald-500/20', 'text-emerald-300', 'border-emerald-500/40');
            dot.className = 'status-dot w-1.5 h-1.5 rounded-full bg-emerald-400';
            text.textContent = 'Selesai';
            btnConvert.classList.add('hidden');
            btnPreview.classList.remove('hidden');
            btnShowFolder.classList.remove('hidden');
            btnDownload.classList.remove('hidden');
            btnDownload.href = `/api/download/${task.id}`;
            progressSection.classList.add('hidden');
            errorSection.classList.add('hidden');

            if (task.output_size_formatted) {
                outputSizeTag.classList.remove('hidden');
                outputSizeTag.innerHTML = `· MP3: <b class="text-emerald-400">${task.output_size_formatted}</b>`;
            }

            if (task.output_path) {
                outputPathSection.classList.remove('hidden');
                outputPathText.textContent = task.output_path;
                outputPathText.title = task.output_path;
            }
        } else if (task.status === 'error') {
            badge.classList.add('bg-red-500/10', 'text-red-400', 'border-red-500/20');
            dot.className = 'status-dot w-1.5 h-1.5 rounded-full bg-red-400';
            text.textContent = 'Gagal';
            btnConvert.classList.remove('hidden');
            btnPreview.classList.add('hidden');
            btnShowFolder.classList.add('hidden');
            btnDownload.classList.add('hidden');
            progressSection.classList.add('hidden');
            outputPathSection.classList.add('hidden');
            errorSection.classList.remove('hidden');
            errorText.textContent = task.error || 'Terjadi kesalahan FFmpeg. Pastikan file video valid dan memiliki trek suara.';
        }
    }

    // --- Show File in Explorer ---
    async function showInFolder(taskId) {
        try {
            const res = await fetch(`/api/show-in-folder/${taskId}`, { method: 'POST' });
            if (!res.ok) {
                const err = await res.json();
                alert('Gagal membuka file di folder: ' + err.detail);
            }
        } catch (err) {
            console.error('Error showing in folder:', err);
        }
    }

    // --- Conversion Handlers ---
    async function convertSingle(taskId) {
        const options = getConversionOptions();
        try {
            const res = await fetch(`/api/convert/${taskId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(options)
            });
            if (res.ok) {
                const task = tasks.get(taskId);
                if (task) {
                    task.status = 'converting';
                    task.progress = 0;
                    renderTaskList();
                }
                startPolling();
            }
        } catch (err) {
            console.error('Error starting conversion:', err);
        }
    }

    async function convertAll() {
        const readyIds = Array.from(tasks.values())
            .filter(t => t.status === 'ready' || t.status === 'error')
            .map(t => t.id);

        if (readyIds.length === 0) return;

        btnConvertAll.disabled = true;
        btnConvertAll.classList.add('opacity-50');

        const options = getConversionOptions();
        try {
            const res = await fetch('/api/convert-batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    task_ids: readyIds,
                    ...options
                })
            });

            if (res.ok) {
                readyIds.forEach(id => {
                    const task = tasks.get(id);
                    if (task) {
                        task.status = 'queued';
                        task.progress = 0;
                    }
                });
                renderTaskList();
                startPolling();
            }
        } catch (err) {
            console.error('Error in batch convert:', err);
        } finally {
            btnConvertAll.disabled = false;
            btnConvertAll.classList.remove('opacity-50');
        }
    }

    btnConvertAll.addEventListener('click', convertAll);

    // --- ZIP Download Handler ---
    async function downloadZip() {
        const completedIds = Array.from(tasks.values())
            .filter(t => t.status === 'completed')
            .map(t => t.id);

        if (completedIds.length === 0) return;

        btnDownloadZip.disabled = true;
        btnDownloadZip.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Menyiapkan ZIP...</span>`;
        if (window.lucide) lucide.createIcons();

        try {
            const res = await fetch('/api/download-zip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task_ids: completedIds })
            });

            if (!res.ok) throw new Error('Gagal membuat file ZIP.');

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `converted_mp3_batch_${Date.now()}.zip`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();
        } catch (err) {
            alert('Kesalahan download ZIP: ' + err.message);
        } finally {
            btnDownloadZip.disabled = false;
            btnDownloadZip.innerHTML = `<i data-lucide="archive" class="w-4 h-4"></i><span>Download Semua (.ZIP)</span>`;
            if (window.lucide) lucide.createIcons();
        }
    }

    btnDownloadZip.addEventListener('click', downloadZip);

    // --- Delete / Clear Handlers ---
    async function deleteTask(taskId) {
        if (currentPlayingTaskId === taskId) {
            stopAudioPlayer();
        }
        try {
            await fetch(`/api/task/${taskId}`, { method: 'DELETE' });
            tasks.delete(taskId);
            renderTaskList();
        } catch (err) {
            console.error('Error deleting task:', err);
        }
    }

    async function clearAll() {
        if (!confirm('Apakah Anda yakin ingin menghapus semua file dalam daftar?')) return;
        stopAudioPlayer();
        try {
            await fetch('/api/clear', { method: 'POST' });
            tasks.clear();
            renderTaskList();
        } catch (err) {
            console.error('Error clearing tasks:', err);
        }
    }

    btnClearAll.addEventListener('click', clearAll);

    // --- Polling for Real-Time Status ---
    function startPolling() {
        if (pollInterval) return;

        pollInterval = setInterval(async () => {
            const activeTasks = Array.from(tasks.values()).filter(t => t.status === 'converting' || t.status === 'queued');

            if (activeTasks.length === 0) {
                stopPolling();
                return;
            }

            try {
                const res = await fetch('/api/tasks');
                if (res.ok) {
                    const serverTasks = await res.json();
                    serverTasks.forEach(st => {
                        if (tasks.has(st.id)) {
                            tasks.set(st.id, st);
                        }
                    });
                    renderTaskList();
                }
            } catch (err) {
                console.error('Polling error:', err);
            }
        }, 800);
    }

    function stopPolling() {
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
    }

    // --- Audio Player Logic ---
    function playAudioPreview(taskId) {
        const task = tasks.get(taskId);
        if (!task || task.status !== 'completed') return;

        currentPlayingTaskId = taskId;
        playerTrackTitle.textContent = task.output_filename || task.original_filename;
        playerTrackInfo.textContent = `MP3 Preview · ${task.output_size_formatted || ''}`;

        globalAudio.src = `/api/preview/${taskId}?t=${Date.now()}`;
        globalAudio.play();

        audioPlayerBar.classList.remove('translate-y-full');
        updatePlayPauseIcon(true);
    }

    function stopAudioPlayer() {
        globalAudio.pause();
        globalAudio.currentTime = 0;
        audioPlayerBar.classList.add('translate-y-full');
        currentPlayingTaskId = null;
        updatePlayPauseIcon(false);
    }

    function updatePlayPauseIcon(isPlaying) {
        if (isPlaying) {
            playerPlayIcon.setAttribute('data-lucide', 'pause');
        } else {
            playerPlayIcon.setAttribute('data-lucide', 'play');
        }
        if (window.lucide) lucide.createIcons();
    }

    playerPlayBtn.addEventListener('click', () => {
        if (globalAudio.paused) {
            globalAudio.play();
            updatePlayPauseIcon(true);
        } else {
            globalAudio.pause();
            updatePlayPauseIcon(false);
        }
    });

    playerCloseBtn.addEventListener('click', stopAudioPlayer);

    globalAudio.addEventListener('timeupdate', () => {
        if (!isNaN(globalAudio.duration) && globalAudio.duration > 0) {
            playerSeekBar.value = (globalAudio.currentTime / globalAudio.duration) * 100;
            playerCurrentTime.textContent = formatTime(globalAudio.currentTime);
            playerDuration.textContent = formatTime(globalAudio.duration);
        }
    });

    playerSeekBar.addEventListener('input', () => {
        if (!isNaN(globalAudio.duration)) {
            globalAudio.currentTime = (playerSeekBar.value / 100) * globalAudio.duration;
        }
    });

    playerVolume.addEventListener('input', () => {
        globalAudio.volume = playerVolume.value;
    });

    playerRewindBtn.addEventListener('click', () => {
        globalAudio.currentTime = Math.max(0, globalAudio.currentTime - 5);
    });

    playerForwardBtn.addEventListener('click', () => {
        globalAudio.currentTime = Math.min(globalAudio.duration || 0, globalAudio.currentTime + 5);
    });

    globalAudio.addEventListener('ended', () => {
        updatePlayPauseIcon(false);
    });

    function formatTime(seconds) {
        if (isNaN(seconds) || seconds < 0) return '00:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    function escapeHtml(string) {
        const div = document.createElement('div');
        div.innerText = string;
        return div.innerHTML;
    }

    // Theme toggle
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    themeToggleBtn.addEventListener('click', () => {
        document.documentElement.classList.toggle('dark');
    });

    // Initial render
    renderTaskList();
});
