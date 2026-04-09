// 播放列表配置
// - 本地文件：放到 public/music/ 目录下，用 /music/xxx.mp3 引用
// - 外链：直接填完整 URL
// 按需添加/删除歌曲即可

export const playlist = [
  {
    title: '晴天',
    artist: '周杰伦',
    // 示例外链 — 替换为你自己的音乐链接
    src: 'https://music.163.com/song/media/outer/url?id=186016',
  },
  {
    title: '平凡之路',
    artist: '朴树',
    src: 'https://music.163.com/song/media/outer/url?id=28815250',
  },
  {
    title: '示例本地歌曲',
    artist: '未知艺术家',
    // 本地文件示例 — 把 mp3 放到 public/music/ 目录后取消注释
    // src: '/music/my-song.mp3',
    src: 'https://music.163.com/song/media/outer/url?id=1901371647',
  },
];
