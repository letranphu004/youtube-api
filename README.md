# YouTube Live Grid

Trang landing hiển thị các kênh YouTube bạn theo dõi dạng grid; kênh nào đang live được highlight (viền đỏ, badge LIVE, thumbnail stream, số người xem) và đẩy lên đầu.

## Chạy

```bash
npm start          # http://localhost:3000
```

Không cần cài dependency (Node 11+).

## Thêm / bớt kênh

Sửa `config.js` — dùng `handle` (`@TenKenh`) hoặc `id` (`UC...`), `tag` để lọc theo nhóm:

```js
{ handle: '@TenKenh', tag: 'Music' },
```

## Nguồn dữ liệu

- Mặc định: đọc trang YouTube công khai (`/<kênh>/live`), không cần key.
- Ổn định hơn: tạo file `.env` (xem `.env.example`) với `YOUTUBE_API_KEY=...` để dùng YouTube Data API v3
  (tốn ~1 unit quota / 50 video mỗi lần làm mới, không dùng `search.list` 100 unit).
