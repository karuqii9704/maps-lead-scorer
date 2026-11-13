# Maps Lead Scorer

Extension Chrome (Manifest V3) untuk pemakaian pribadi. Di halaman hasil pencarian Google Maps, extension ini membaca kartu bisnis yang sedang tampil, memberi skor 0–100 sebagai calon pelanggan, lalu menampilkannya di panel yang bisa difilter, diurutkan, dan diekspor ke CSV.

Tidak terikat niche: cari "klinik kecantikan Bandung", "klinik gigi Surabaya", "bengkel Bekasi", atau apa pun.

## Pasang

1. Buka `chrome://extensions` di Chrome.
2. Nyalakan **Developer mode** (kanan atas).
3. Klik **Load unpacked**, pilih folder hasil clone repo ini (folder yang berisi `manifest.json`).
4. Buka `https://www.google.com/maps` dan cari sesuatu. Panel "Maps Lead Scorer" muncul di kanan.

Setelah mengubah file, klik ikon reload pada kartu extension di `chrome://extensions`, lalu muat ulang tab Maps.

## Cara pakai

1. Cari kategori bisnis + kota di Google Maps.
2. Panel otomatis memindai kartu yang tampil. Scroll daftar hasil untuk memuat kartu baru; kartu baru ikut dipindai. Tombol **Scan hasil** memindai ulang secara manual.
3. Kartu di daftar hasil biasanya tidak menampilkan website dan telepon. Lead seperti itu ditandai **data belum lengkap** dan kolomnya berisi `?`. Klik baris di panel (atau kartu di Maps) untuk membuka detail tempat. Website, telepon, dan alamat lengkap terbaca dari panel detail, lalu skor dihitung ulang.
4. Filter: skor minimum, ulasan minimum, "Tanpa website saja", cari nama/kategori. Klik judul kolom untuk mengurutkan.
5. **Export CSV** mengekspor daftar yang sedang terfilter (UTF-8 dengan BOM, langsung terbuka di Excel).
6. Daftar terkumpul lintas scroll dan pencarian, disimpan di `chrome.storage.local`. **Hapus daftar** mengosongkannya.

## Skor

| Sinyal | Poin default |
|---|---|
| Belum punya website | +40 |
| Website hanya media sosial / link-in-bio | +25 |
| Ada nomor telepon | +15 |
| Ulasan ≥ 30 | +20 |
| Ulasan 10–29 | +10 |
| Rating 3,5–4,4 | +10 |
| Rating ≥ 4,5 | +5 |
| Tutup permanen atau sementara | skor dipaksa 0 |

Maksimal 100. Label: ≥70 **Potensial**, 40–69 **Lumayan**, <40 **Rendah**.

Field yang tidak ditampilkan halaman dicatat sebagai "belum diketahui", bukan "tidak ada", dan bernilai 0 poin. "Belum punya website" baru dihitung setelah panel detail tempat itu dibuka dan memang tidak ada tautan website.

Bobot dan daftar host media sosial bisa diubah di halaman pengaturan: `chrome://extensions` → Maps Lead Scorer → **Details** → **Extension options**.

## Pakai sebagai MCP

Repo ini juga server MCP, jadi agen AI mana pun yang mendukung MCP bisa mencari dan menilai lead sendiri. Server membuka browser sungguhan lewat Playwright, mencari di Google Maps, membuka tiap tempat untuk membaca website dan telepon, lalu memberi skor memakai modul yang sama dengan extension (`src/selectors.js`, `src/extract.js`, `src/score.js`, `src/csv.js`).

Dua transport: **stdio** (default, server dijalankan oleh klien) dan **Streamable HTTP** (`--http`, untuk server jarak jauh atau VPS).

**Baca bagian "Batasan" di bawah dulu.** Mode ini adalah pengumpulan data otomatis, dan ketentuan Google membatasinya.

### Pasang: stdio

Perlu Node.js 20+. Tambahkan ke konfigurasi `mcpServers` klien MCP Anda:

```json
{
  "mcpServers": {
    "maps-lead-scorer": {
      "command": "npx",
      "args": ["-y", "github:karuqii9704/maps-lead-scorer"]
    }
  }
}
```

Dari hasil clone: `npm install`, lalu pakai `"command": "node", "args": ["/path/ke/maps-lead-scorer/mcp/server.js"]`.

Browser: server memakai Google Chrome yang terpasang. Kalau tidak ada (misalnya di Linux server), server memakai Chromium bawaan Playwright. Unduh sekali:

```bash
npx playwright install --with-deps chromium
```

### Pasang: Streamable HTTP

```bash
MLS_AUTH_TOKEN=ganti-dengan-token-acak-minimal-16-karakter \
MLS_HOST=0.0.0.0 MLS_PORT=3333 \
node mcp/server.js --http
```

- Endpoint: `http://HOST:3333/mcp` (hanya `POST`, tanpa sesi). `GET /healthz` untuk cek hidup.
- Klien mengirim header `Authorization: Bearer <token>`. Contoh konfigurasi klien:

```json
{
  "mcpServers": {
    "maps-lead-scorer": {
      "url": "https://host-anda.example/mcp",
      "headers": { "Authorization": "Bearer ganti-dengan-token-acak-minimal-16-karakter" }
    }
  }
}
```

- Default bind `127.0.0.1:3333` tanpa token. Jika `MLS_HOST` bukan loopback, **`MLS_AUTH_TOKEN` wajib** (minimal 16 karakter); tanpa itu server menolak start. Token dibandingkan dengan waktu konstan.
- Server tidak membuat TLS. Letakkan di belakang reverse proxy HTTPS (nginx, Caddy) atau jaringan privat; jangan buka token lewat HTTP polos di internet.
- Di mode HTTP, `export_csv` hanya boleh menulis di dalam `MLS_OUTPUT_DIR` (atau folder kerja server).

### Pasang: VPS Linux

1. Node.js 20+ dan dependency sistem browser:

   ```bash
   git clone https://github.com/karuqii9704/maps-lead-scorer.git /opt/maps-lead-scorer
   cd /opt/maps-lead-scorer
   npm ci --omit=dev
   npx playwright install --with-deps chromium
   sudo apt-get install -y xvfb xauth
   ```

2. **Jalankan di bawah `xvfb-run -a`.** Chrome headless mendapat tampilan Maps yang lebih ringkas tanpa jumlah ulasan (diamati 2026-11-13), sehingga skor kehilangan poin ulasan. Dengan layar virtual, server mendeteksi `DISPLAY` dan memakai mode berlayar (headful) otomatis, tanpa memalsukan user agent.

   ```bash
   xvfb-run -a -s "-screen 0 1280x960x24" node mcp/server.js --http
   ```

3. Contoh unit systemd `/etc/systemd/system/maps-lead-scorer.service` (buat user `mls`, simpan token di `/etc/maps-lead-scorer.env` dengan izin `600`, isi `MLS_AUTH_TOKEN=...`):

   ```ini
   [Unit]
   Description=Maps Lead Scorer MCP
   After=network.target

   [Service]
   User=mls
   WorkingDirectory=/opt/maps-lead-scorer
   EnvironmentFile=/etc/maps-lead-scorer.env
   Environment=MLS_HOST=127.0.0.1 MLS_PORT=3333 MLS_OUTPUT_DIR=/var/lib/maps-lead-scorer
   StateDirectory=maps-lead-scorer
   ExecStart=/usr/bin/xvfb-run -a -s "-screen 0 1280x960x24" /usr/bin/node mcp/server.js --http
   Restart=on-failure

   [Install]
   WantedBy=multi-user.target
   ```

   Contoh ini bind ke loopback; arahkan reverse proxy HTTPS ke `127.0.0.1:3333`. Untuk bind ke antarmuka lain, ubah `MLS_HOST` (token tetap wajib).

### Pasang: Docker

`Dockerfile` memakai image resmi Playwright (versi di-pin sama dengan `playwright` di `package.json`), menambah `xvfb`, dan menjalankan mode HTTP sebagai user non-root. Tidak ada rahasia di dalam image; token diberikan saat `docker run`.

```bash
docker build -t maps-lead-scorer .
docker run --rm -e MLS_AUTH_TOKEN=ganti-dengan-token-acak-minimal-16-karakter \
  -p 127.0.0.1:3333:3333 -v mls-data:/data maps-lead-scorer
```

Jika versi `playwright` di `package.json` diubah, ubah juga tag image di baris `FROM`.

### Tools

| Tool | Fungsi |
|---|---|
| `search_leads` | `{ query, maxResults?, enrichDetails?, minScore?, noWebsiteOnly?, weights? }`. Cari di Maps, scroll daftar, baca kartu, buka tiap tempat (website, telepon, alamat), beri skor, saring, urutkan dari skor tertinggi. `maxResults` default 20, maksimal 60. |
| `get_place` | `{ mapsUrl, weights? }`. Satu URL tempat `https://www.google.com/maps/...` → satu lead lengkap dengan skor. Host lain ditolak. |
| `score_leads` | `{ leads, weights? }`. Hitung ulang skor, misalnya dengan bobot lain. Tanpa browser, jalan offline. |
| `export_csv` | `{ leads, path? }`. Tulis CSV (UTF-8 BOM, terbuka di Excel) di mesin tempat server berjalan. Path harus berakhiran `.csv`; default `leads-<waktu>.csv`. Mengembalikan path absolut. |

Nama bobot untuk `weights` sama dengan tabel skor di atas: `noWebsite`, `socialOnly`, `phone`, `reviewsHigh`, `reviewsMid`, `ratingMid`, `ratingHigh`.

### Variabel lingkungan

| Variabel | Default | Arti |
|---|---|---|
| `MLS_AUTH_TOKEN` | kosong | Bearer token untuk mode HTTP. Wajib (min. 16 karakter) jika `MLS_HOST` bukan loopback. |
| `MLS_HOST` | `127.0.0.1` | Alamat bind mode HTTP. |
| `MLS_PORT` | `3333` | Port mode HTTP. |
| `MLS_HEADLESS` | otomatis | `true` / `false` memaksa. Otomatis: berlayar (headful) jika ada display (Windows, macOS, atau Linux dengan `DISPLAY` / `WAYLAND_DISPLAY`), selain itu headless. Headless kehilangan jumlah ulasan. |
| `MLS_HL` | `id` | Bahasa antarmuka Maps (`hl=`). Selector dan pola teks diverifikasi untuk `id`; `en` juga didukung. |
| `MLS_OUTPUT_DIR` | folder kerja server | Basis untuk path relatif di `export_csv`. |

### Perilaku dan batas

- Jeda acak 1,5–3 detik antar scroll dan antar pembukaan tempat. Tidak bisa dikecilkan. Satu tempat memakan sekitar 5–8 detik, jadi 20 hasil dengan detail butuh sekitar 2–3 menit. Atur timeout klien sesuai, atau kecilkan `maxResults`. Server mengirim notifikasi progress jika klien meminta.
- Maksimal 60 hasil per panggilan. Panggilan paralel diantrekan satu per satu.
- Satu browser dipakai ulang selama server hidup, lalu ditutup saat server berhenti.
- Di mode berlayar, jendela Chrome terbuka selama pencarian. Biarkan terbuka.
- Kalau Google menampilkan CAPTCHA atau halaman "lalu lintas tidak biasa", server berhenti dan mengembalikan error. Server tidak menyelesaikan atau melewati CAPTCHA, tidak memakai plugin stealth, proxy, atau pemalsuan fingerprint. Tunggu, kurangi volume, atau cari manual di browser Anda. IP datacenter (VPS) lebih sering diminta CAPTCHA daripada IP rumahan.
- Halaman persetujuan Google (jika muncul) dijawab dengan menolak yang tidak esensial.
- Hanya data listing bisnis. Nama pengulas dan isi ulasan tidak dibaca.
- Jika berjalan headless, jumlah ulasan hilang. Skor tetap dihitung tanpa poin ulasan, dan hasil memuat peringatan.

## Batasan

- **Markup Google Maps bisa berubah kapan saja.** Semua selector ada di `src/selectors.js`; kalau panel berhenti membaca data, perbaiki file itu. Selector diverifikasi pada Maps berbahasa Indonesia (`hl=id`) tanggal 2026-11-11. Pola teks mendukung Indonesia dan Inggris.
- **Data hanya apa yang ditampilkan halaman.** Extension membaca halaman Maps di browser Anda; ia tidak mengirim request ke Google atau server mana pun, tidak membuka halaman di latar belakang, dan tidak mengunjungi website bisnis. Server MCP berbeda: ia membuka browser sendiri dan memuat halaman Maps atas nama Anda. Keduanya hanya menyimpan data listing bisnis (nama, kategori, rating, jumlah ulasan, telepon, alamat, website). Nama pengulas dan isi ulasan tidak diambil, dan website bisnis tidak dikunjungi.
- **Ketentuan Google membatasi pengumpulan data otomatis dari Maps.** Extension dimaksudkan untuk prospecting manual dan pribadi dengan kecepatan manusia: Anda sendiri yang mencari, scroll, dan membuka tempat. **Mode MCP adalah pengumpulan otomatis**, jadi melanggar batasan itu secara langsung; risikonya ada pada Anda. Jaga volume tetap kecil, jangan dijadwalkan atau dijalankan massal, dan jangan menjual ulang data. Google bisa menampilkan CAPTCHA atau memblokir IP Anda kapan saja, dan server ini tidak akan menghindarinya.
- Pembacaan website dan telepon langsung dari kartu daftar hasil belum terverifikasi di Maps live, karena layout yang diperiksa tidak menampilkannya di kartu. Jalur yang terverifikasi adalah lewat panel detail.
- Tempat yang panel detailnya tidak punya alamat, telepon, atau website sama sekali akan tetap berstatus "data belum lengkap".
- Hanya berjalan di `https://www.google.com/maps/*`. Kalau Maps Anda terbuka di domain lain (misalnya `google.co.id`), tambahkan polanya ke `matches` di `manifest.json`.
- Skor adalah heuristik awal, bukan penilaian kualitas bisnis.

## Pengembangan

Extension tidak punya build step dan tidak butuh dependency. Dependency (`@modelcontextprotocol/sdk`, `playwright`, `zod`) hanya untuk server MCP.

```bash
npm install
npm test
```

Test mencakup modul murni dan smoke test MCP offline (tanpa browser, tanpa jaringan). `search_leads` dan `get_place` hanya bisa dicoba langsung ke Maps.

- `src/selectors.js` — selector dan pola teks Maps.
- `src/extract.js` — kartu / panel detail → data lead (murni, diuji).
- `src/score.js` — lead + bobot → skor dan alasan (murni, diuji).
- `src/csv.js` — daftar lead → CSV (murni, diuji).
- `src/content.js`, `src/panel.css` — panel di halaman Maps.
- `options.html`, `src/options.js` — pengaturan bobot dan host media sosial.
- `mcp/server.js` — entry server MCP (stdio atau `--http`).
- `mcp/tools.js` — definisi tools. `mcp/http.js` — transport Streamable HTTP dan auth.
- `mcp/browser.js` — Playwright: buka Maps, scroll, suntik `src/selectors.js` + `src/extract.js` ke halaman.
- `test/` — fixture HTML, DOM mini untuk Node, dan test.

## Lisensi

MIT. Lihat `LICENSE`.
