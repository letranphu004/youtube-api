// Danh sách kênh hiển thị trên trang. Chỉ các kênh ở đây mới được show.
// Mỗi kênh dùng `handle` (@TenKenh) hoặc `id` (UC...), `tag` (tuỳ chọn) để lọc theo nhóm.
// Sửa xong không cần restart server — lần làm mới tiếp theo sẽ dùng danh sách mới.

module.exports = {
  refreshSeconds: 60,
  channels: [
    { handle: '@TanVuu' },
    { handle: '@himass6999', tag: 'AL' },
    { handle: '@taikonnbackup', tag: 'AL' },
    { handle: '@Delwyn' },
    { handle: '@sololzy130' },
    { handle: '@metald2110' },
    { handle: '@YmCud' },
  ],

};
