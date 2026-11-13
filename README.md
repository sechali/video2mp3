# 🎬 Video to MP3 Converter Web Studio

Aplikasi berbasis web modern untuk mengubah (convert) file video (**MP4, MKV, AVI, MOV, WEBM, FLV, WMV, 3GP, TS**, dan format video lainnya) menjadi file audio **MP3** berkualitas tinggi, baik **satu per satu** maupun secara **batch (banyak file sekaligus)**.

---

## ✨ Fitur Utama

1. **Konversi Satuan & Batch (Sekaligus Banyak)**:
   - Unggah satu file atau puluhan file video sekaligus via drag & drop.
   - Tombol **"Konversi"** per-file untuk kontrol individual.
   - Tombol **"Konversi Semua (Batch)"** untuk memproses seluruh antrean secara paralel & efisien.
2. **Kualitas Audio yang Dapat Disesuaikan**:
   - **Bitrate**: 320 kbps (Studio), 256 kbps (Tinggi), 192 kbps (Standar), 128 kbps (Ringan), 96 kbps (Hemat).
   - **Sample Rate**: 44.1 kHz (Standar CD), 48.0 kHz (Standar Video/Broadcast), 32 kHz, 22.05 kHz.
   - **Audio Channels**: Stereo (2 Channel) atau Mono (1 Channel).
   - **Penyetelan Volume**: Asli, Normalisasi Suara otomatis (*EBU R128 loudnorm*), atau Volume Boost (+3 dB / +6 dB).
3. **Real-time Live Progress Bar**:
   - Menampilkan persentase konversi (0% - 100%) dan kecepatan encoding (*speed multiplier*) secara real-time.
4. **Pemutar Audio Bawaan (In-Browser MP3 Preview)**:
   - Dengarkan hasil audio MP3 langsung di browser sebelum mengunduhnya, lengkap dengan slider seek dan pengatur volume.
5. **Download Fleksibel**:
   - Download file MP3 satu per satu langsung ke komputer.
   - Download semua file yang telah selesai dikonversi dalam **1 file arsip ZIP**.
6. **Performa Tinggi**:
   - Menggunakan backend **FastAPI** dengan engine **FFmpeg 9** multi-thread native (encoding `libmp3lame`).

---

## 🚀 Cara Menjalankan

### Cara Cepat (Windows):
Cukup klik dua kali pada file:
```
run.bat
```

Atau jalankan via Terminal / PowerShell:
```powershell
python app.py
```

Setelah server aktif, buka browser favorit Anda di:
👉 **http://localhost:8000**

---

## 📁 Struktur Direktori

```
f:\AI\converter\
│
├── app.py                 # Backend server FastAPI & integrasi FFmpeg
├── requirements.txt       # Daftar dependensi Python
├── run.bat                # Shortcut peluncur aplikasi di Windows
├── README.md              # Dokumentasi lengkap
│
├── templates/
│   └── index.html         # Antarmuka web modern & responsif
│
├── static/
│   ├── css/
│   │   └── style.css      # Styling custom & animasi
│   └── js/
│       └── app.js         # Logika frontend, upload, polling, audio player
│
├── uploads/               # Direktori sementara file video yang diunggah
└── converted/             # Direktori penyimpanan hasil audio MP3 & arsip ZIP
```

---

## 🛠️ Persyaratan Sistem
- Python 3.10+
- FFmpeg (sudah terpasang di sistem PATH)
- Browser modern (Chrome, Edge, Firefox, Safari, Opera)
