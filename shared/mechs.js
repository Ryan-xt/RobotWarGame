// Six wasteland mechs. Each has a one-button right-click skill and a passive.
export const MECHS = {
  assault: {
    id: 'assault', name: '破阵', en: 'RAMSHAKER', role: '突击型',
    hull: '#a8432c', accent: '#ffb02e', trim: '#e7d3a3', glow: '#ff8a3d',
    blurb: '前倾重甲，肩甲冲撞板。近身压制，越打越热。',
    skill: { name: '冲撞', cd: 6, desc: '向前冲撞 3.5m，撞中敌人 +18 过载并击退' },
    passive: { name: '加固装甲', desc: '受到的过载增长 -10%' },
    stats: { speed: 1.0, heat: 0.9, power: 1.15, control: 0.9 },
    shape: 'assault',
  },
  grappler: {
    id: 'grappler', name: '索命', en: 'HOOKJAW', role: '钩爪型',
    hull: '#6f7a80', accent: '#ffd83d', trim: '#3b4448', glow: '#ffd83d',
    blurb: '细长灵活，背部钩爪装置。把敌人从掩体后拽出来。',
    skill: { name: '钩爪', cd: 5, desc: '钩中敌人将其拽近并 +8 过载；钩中墙面则自己飞过去' },
    passive: { name: '回弹加速', desc: '反弹后的电磁弹弹速 +15%' },
    stats: { speed: 1.08, heat: 1.0, power: 1.0, control: 1.15 },
    shape: 'grappler',
  },
  guardian: {
    id: 'guardian', name: '铁壁', en: 'BULWARK', role: '护盾型',
    hull: '#55684a', accent: '#7fe0ff', trim: '#c9c1a4', glow: '#5ad8ff',
    blurb: '宽厚方正，可展开电磁盾。防守反击的定海神针。',
    skill: { name: '电磁盾', cd: 8, desc: '展开 1.5 秒电磁盾，反弹来袭电磁弹' },
    passive: { name: '高效散热', desc: '所有散热速度 +20%' },
    stats: { speed: 0.95, heat: 1.05, power: 1.0, control: 1.0 },
    shape: 'guardian',
  },
  miner: {
    id: 'miner', name: '雷匠', en: 'SAPPER', role: '布雷型',
    hull: '#a9864d', accent: '#ff7043', trim: '#4a3a28', glow: '#ff5a36',
    blurb: '低矮多足，背部雷舱。把整片场地变成雷区。',
    skill: { name: '电磁地雷', cd: 4, desc: '放置地雷，2 秒后待命；触发或击爆造成 +25 过载' },
    passive: { name: '排雷专家', desc: '免疫自己地雷的伤害' },
    stats: { speed: 0.92, heat: 1.0, power: 1.0, control: 1.1 },
    shape: 'miner',
  },
  sniper: {
    id: 'sniper', name: '长钉', en: 'SPIKE', role: '狙击型',
    hull: '#3f5873', accent: '#46d9ff', trim: '#d0dde8', glow: '#46d9ff',
    blurb: '高瘦长炮，远程压制。蓄力时脚步会放慢。',
    skill: { name: '磁轨长钉', cd: 1.8, desc: '按住蓄力 0.7 秒后松开发射高速弹，+20 过载' },
    passive: { name: '稳定枪架', desc: '蓄力时移速 -20%，但弹速极快' },
    stats: { speed: 1.02, heat: 1.0, power: 1.25, control: 1.2 },
    shape: 'sniper',
  },
  furnace: {
    id: 'furnace', name: '炉心', en: 'COREFURNACE', role: '自爆型',
    hull: '#b94f26', accent: '#ffcf4d', trim: '#5b3a2c', glow: '#ffcf4d',
    blurb: '圆鼓炉心，外露反应炉。把命当引信的疯子。',
    skill: { name: '过载起爆', cd: 2.5, desc: '点燃 3 秒引信，再次按下取消；引爆即短路自毁' },
    passive: { name: '超限炉心', desc: '短路爆炸范围 +50%' },
    stats: { speed: 0.96, heat: 1.1, power: 1.2, control: 0.95 },
    shape: 'furnace',
  },
};

export const MECH_LIST = Object.values(MECHS);
export function mechOf(id) { return MECHS[id] || MECHS.assault; }
