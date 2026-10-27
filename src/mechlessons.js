// 六台机体的专属课程。
//
// 每一台机体都有自己的射击节奏、技能和被动，所以「通用教程」只能教按键；
// 真正要练的是「这台机体怎么打」。这里给每台机体写了两套课：
//
//   tutorial —— 专属教程：技能怎么放、怎么打中、这台机体的脾气（被动 / 热量 / 射程）
//   advanced —— 进阶玩法：这台机体在实战里的连招、怎么活下来、怎么赢
//
// 每一步都是对「这一局里发生过的事」的判定（done(w, base)），w 是本局累计
// 计数，base 是进入这一步时的快照，所以「击杀 1 台」永远指这一步之内打死的。
//
// 可选的 `fire: true` 表示这一步需要对面开枪（比如铁壁的盾反），
// 教程里那台陪练机会在这一步被叫醒、开始还击。
import { MECHS } from '../shared/mechs.js';

export const LESSON_META = {
  assault: {
    tagline: '撞进去，别停下',
    playstyle: '近身压制：冲撞开团 → 贴身点射 → 用被动减伤硬吃第一轮',
  },
  grappler: {
    tagline: '把人从掩体后面拽出来',
    playstyle: '钩爪控场：钩中拉近 → 贴脸打完 → 钩墙逃跑',
  },
  guardian: {
    tagline: '举盾，然后反打',
    playstyle: '盾反流：开盾吃弹 → 反弹回去 → 趁对面空窗期输出',
  },
  miner: {
    tagline: '把整片场地变成雷区',
    playstyle: '布雷封锁：提前埋雷 → 把对手逼进雷区 → 用子弹点爆地雷',
  },
  sniper: {
    tagline: '一枪一条命',
    playstyle: '远程点名：卡 15 米外 → 蓄力打提前量 → 被贴脸就冲刺拉开',
  },
  furnace: {
    tagline: '把命当引信',
    playstyle: '自杀式开团：点燃引信冲进去 → 逼对手跑位 → 引爆换人头',
  },
};

const S = (o) => o; // keep the table below readable / syntax-checked

export const MECH_LESSONS = {
  assault: {
    tutorial: [
      S({
        id: 'skill', title: '认识冲撞', keys: '鼠标右键',
        text: '「破阵」右键是向前冲撞 3.5 米：撞中的敌人 +18 过载并被击退。' +
          '它既是开团手段，也是唯一的位移。先放一次，感受一下冲出去的距离。',
        goal: '使用 1 次冲撞',
        tip: '冲撞方向 = 你当前准星方向，撞之前先把准星摆到目标身上。',
        done: (w, b) => w.charges - b.charges >= 1,
      }),
      S({
        id: 'hit', title: '撞中靶子', keys: '右键 · 贴身',
        text: '冲撞只有撞到人才有伤害。站到 3 米左右，准星压在靶子上再撞。撞中 2 次过关。',
        goal: '冲撞命中 2 次',
        tip: '离得太远会停在半路；离得太近会直接撞过去（贴脸反而容易空）。',
        done: (w, b) => w.chargeHits - b.chargeHits >= 2,
      }),
      S({
        id: 'close', title: '近身压制', keys: '左键 · 8 米内',
        text: '「破阵」的伤害和距离无关，越近越稳。在 8 米内用左键命中 6 次，' +
          '这就是它的主战场。',
        goal: '8 米内命中 6 次',
        tip: '边走边打：你的移速是 1.0，别站着当靶子。',
        done: (w, b) => w.closeHits - b.closeHits >= 6,
      }),
      S({
        id: 'duel', title: '实战：撞死一个', keys: '右键 + 左键',
        text: '靶机醒了，它会还手。冲撞起手 → 贴身点射 → 它想跑就再撞一次。击倒 1 台。',
        goal: '击倒 1 台 AI',
        tip: '被动「加固装甲」让你受到的过载 -10%：你比它更耐打，别怕换血。',
        done: (w, b) => w.kills - b.kills >= 1,
      }),
    ],
    advanced: [
      S({
        id: 'combo', title: '冲撞接平射', keys: '右键 → 左键',
        text: '冲撞之后敌人被击退，会有一个短暂的「被顶飞」空窗。撞中后 2 秒内补枪，' +
          '命中 2 次这一整串连招就算练成。',
        goal: '撞中后 2 秒内命中 2 次',
        tip: '撞完不要立刻再撞：技能 6 秒冷却，这段空窗期靠左键压。',
        done: (w, b) => w.chargeCombos - b.chargeCombos >= 2,
      }),
      S({
        id: 'tank', title: '硬吃一轮', keys: '被动 · 加固装甲',
        text: '「破阵」被打时过载增长 -10%，所以它是全游戏最敢换血的机体。' +
          '这局里把热量顶到 70 以上并活下来。',
        goal: '热量到 70 后仍然存活',
        tip: '70 以上会减速，但不会立刻爆；100 才短路。',
        done: (w) => w.maxHeat >= 70 && w.stillAlive !== false,
      }),
      S({
        id: 'escape', title: '冲撞当闪现', keys: '右键 + 空格',
        text: '冲撞既是进攻也是位移：被集火时朝着掩体撞过去比走路快得多。' +
          '这局完成 2 次「冲撞后 1.5 秒内接冲刺」。',
        goal: '冲撞接冲刺 2 次',
        tip: '冲刺无敌帧 0.12 秒，两个位移连着用几乎不可能被抓。',
        done: (w, b) => w.chargeDashes - b.chargeDashes >= 2,
      }),
      S({
        id: 'win', title: '打赢两台', keys: '全部技巧',
        text: '两台 AI 同时在场。用冲撞分割战场：先撞开一台，集中打另一台，' +
          '把它打爆再去处理第二台。击杀 2 台。',
        goal: '击杀 2 台 AI',
        tip: '被两台同时盯上时，先撞开血少的那个，换 1v1 的窗口。',
        done: (w, b) => w.kills - b.kills >= 2,
      }),
    ],
  },

  grappler: {
    tutorial: [
      S({
        id: 'skill', title: '认识钩爪', keys: '鼠标右键',
        text: '「索命」右键是把钩爪甩出去：钩中敌人会把它拽到你面前并 +8 过载；' +
          '钩中墙或钢板，你自己飞过去。先钩中 1 个靶子。',
        goal: '钩爪命中 1 次',
        tip: '钩爪是直线，会被墙挡住；它也是唯一能把人从掩体后拽出来的手段。',
        done: (w, b) => w.hookHits - b.hookHits >= 1,
      }),
      S({
        id: 'wall', title: '钩墙位移', keys: '右键 · 对着墙',
        text: '对着墙或废墟按右键，你会被拉过去——这是「索命」的逃生和绕后手段。' +
          '完成 1 次钩墙位移。',
        goal: '钩墙移动 1 次',
        tip: '钩墙比走路快得多，被追的时候往反方向的墙钩。',
        done: (w, b) => w.hookWalls - b.hookWalls >= 1,
      }),
      S({
        id: 'combo', title: '钩过来再打', keys: '右键 → 左键',
        text: '钩中敌人后它会贴到你脸上，这时候开火几乎不会脱靶。' +
          '钩中后 3 秒内命中 3 次。',
        goal: '钩中后 3 秒内命中 3 次',
        tip: '钩中瞬间先别蓄力，普通弹更稳。',
        done: (w, b) => w.hookCombos - b.hookCombos >= 3,
      }),
      S({
        id: 'duel', title: '实战：钩一个下来', keys: '右键 + 左键',
        text: '靶机醒了。它绕着掩体走的时候，钩爪把它拽到空地上再打。击倒 1 台。',
        goal: '击倒 1 台 AI',
        tip: '被动「回弹加速」让反弹弹 +15% 弹速：贴墙打更容易命中。',
        done: (w, b) => w.kills - b.kills >= 1,
      }),
    ],
    advanced: [
      S({
        id: 'drag', title: '专钩掩体后的人', keys: '右键 · 穿空隙',
        text: '钩爪最值钱的用法：对方躲在墙后只露半个身位时，从墙的空隙钩过去。' +
          '这一局钩中 3 次。',
        goal: '钩中敌人 3 次',
        tip: '钩爪会钩到第一面墙；找墙角、废墟缺口这些「缝」。',
        done: (w, b) => w.hookHits - b.hookHits >= 3,
      }),
      S({
        id: 'rehook', title: '钩墙绕后', keys: '右键 · 对着墙',
        text: '钩墙位移是「索命」的保命技：被追时钩反方向的墙，直接从掩体另一侧绕走。' +
          '这一局钩墙 3 次。',
        goal: '钩墙位移 3 次',
        tip: '钩墙不算技能失败，也不会把冷却拖长——想走就走。',
        done: (w, b) => w.hookWalls - b.hookWalls >= 3,
      }),
      S({
        id: 'win', title: '打赢两台', keys: '全部技巧',
        text: '两台 AI。思路：钩一个过来单挑，打完钩墙换位再找第二个。击杀 2 台。',
        goal: '击杀 2 台 AI',
        tip: '钩爪也是打断：对面蓄力的时候钩它，节奏就断了。',
        done: (w, b) => w.kills - b.kills >= 2,
      }),
    ],
  },

  guardian: {
    tutorial: [
      S({
        id: 'skill', title: '认识电磁盾', keys: '鼠标右键',
        text: '「铁壁」右键展开 1.5 秒电磁盾，把飞来的电磁弹弹回去。先开一次盾。',
        goal: '开盾 1 次',
        tip: '盾是「反弹」不是「免伤」：子弹会飞回去打对面。',
        done: (w, b) => w.shields - b.shields >= 1,
      }),
      S({
        id: 'block', title: '举盾吃弹', keys: '右键 · 对着火力',
        text: '盾开着的时候被打中会反弹。让靶机打你，用盾弹开 2 发。',
        goal: '盾反弹 2 发', fire: true,
        tip: '盾只有 1.5 秒，看到红弧再开，不要提前开。',
        done: (w, b) => w.shieldBounces - b.shieldBounces >= 2,
      }),
      S({
        id: 'counter', title: '盾后反打', keys: '右键 → 左键',
        text: '弹开对面的子弹的那一瞬间是你最安全的时候——趁这时候输出。' +
          '开盾后 2 秒内命中 2 次。',
        goal: '开盾后 2 秒内命中 2 次',
        tip: '盾反的子弹会飞回去，经常不用你补枪对面就已经在升温。',
        done: (w, b) => w.shieldCombos - b.shieldCombos >= 2,
      }),
      S({
        id: 'duel', title: '实战：盾反赢一局', keys: '右键 + 左键',
        text: '靶机醒了。它开枪前会停顿——那就是开盾的时机。击倒 1 台。',
        goal: '击倒 1 台 AI',
        tip: '被动「高效散热」让所有散热 +20%，可以比对面多打一轮。',
        done: (w, b) => w.kills - b.kills >= 1,
      }),
    ],
    advanced: [
      S({
        id: 'reflect', title: '盾反大师', keys: '右键',
        text: '盾的伤害来自「对面自己的子弹」。这一局盾反弹 4 发。',
        goal: '盾反弹 4 发',
        tip: '站定举盾比边跑边举更容易接到弹。',
        done: (w, b) => w.shieldBounces - b.shieldBounces >= 4,
      }),
      S({
        id: 'cool', title: '靠散热打消耗', keys: '散热区',
        text: '「铁壁」散热的被动让它能打持久战。热量顶到 70，再降到 25 以下。',
        goal: '热量 70 → 25 以下',
        tip: '盾挡下的子弹不加你的热，这 1.5 秒其实也在降温。',
        done: (w) => w.heatPeaked && w.cooled,
      }),
      S({
        id: 'win', title: '打赢两台', keys: '全部技巧',
        text: '两台 AI。用盾吃掉第一轮齐射，弹回去，再趁他们空窗期收人头。击杀 2 台。',
        goal: '击杀 2 台 AI',
        tip: '盾不要连着开：8 秒冷却，第二次要留给真正致命的那一轮。',
        done: (w, b) => w.kills - b.kills >= 2,
      }),
    ],
  },

  miner: {
    tutorial: [
      S({
        id: 'skill', title: '认识电磁地雷', keys: '鼠标右键',
        text: '「雷匠」右键在脚下 1.2 米放一颗地雷，2 秒后待命，踩到或被打爆造成 +25 过载。' +
          '最多同时 3 颗。先放 2 颗。',
        goal: '放 2 颗地雷',
        tip: '被动「排雷专家」让你免疫自己的雷——放心在脚边布雷。',
        done: (w, b) => w.mines - b.mines >= 2,
      }),
      S({
        id: 'boom', title: '让敌人踩雷', keys: '右键 · 预判路线',
        text: '雷不会自己找人。把雷放在敌人必经的路上，让靶机踩中 1 次。',
        goal: '地雷炸中敌人 1 次',
        tip: '雷也可以被子弹打爆：预判对面走位，直接把雷点爆在他脸上。',
        done: (w, b) => w.mineHits - b.mineHits >= 1,
      }),
      S({
        id: 'zone', title: '封锁一片地', keys: '右键 ×3',
        text: '「雷匠」的强项是把路封死。让场上同时存在 3 颗待命的地雷。',
        goal: '同时存在 3 颗雷',
        tip: '三颗雷摆成三角，中间就是对面的死区。',
        done: (w) => w.minesLive >= 3,
      }),
      S({
        id: 'duel', title: '实战：雷区收人头', keys: '右键 + 左键',
        text: '靶机醒了。先布雷再开火：把它往雷上赶。击倒 1 台。',
        goal: '击倒 1 台 AI',
        tip: '对面绕掩体时，雷比子弹管用。',
        done: (w, b) => w.kills - b.kills >= 1,
      }),
    ],
    advanced: [
      S({
        id: 'trap', title: '布雷封锁', keys: '右键 · 卡点',
        text: '会玩的「雷匠」不在脚边放雷，而是在对面要跑的那条线上放。这一局雷炸中 3 次。',
        goal: '地雷炸中 3 次',
        tip: '散热区的入口、道具旁边、窄口——这三个位置永远有人踩。',
        done: (w, b) => w.mineHits - b.mineHits >= 3,
      }),
      S({
        id: 'cold', title: '冷血收割', keys: '热量 < 40',
        text: '「雷匠」开火慢，最怕过热。这一局在热量 40 以下击杀 1 台。',
        goal: '热量 < 40 时击杀 1 台',
        tip: '放雷不升温，雷区就是你的第二个弹匣。',
        done: (w, b) => w.coldKills - b.coldKills >= 1,
      }),
      S({
        id: 'win', title: '打赢两台', keys: '全部技巧',
        text: '两台 AI。先把场地铺满雷，再躲进掩体让它们自己踩。击杀 2 台。',
        goal: '击杀 2 台 AI',
        tip: '雷炸中的敌人会升温，补两枪就能收。',
        done: (w, b) => w.kills - b.kills >= 2,
      }),
    ],
  },

  sniper: {
    tutorial: [
      S({
        id: 'skill', title: '认识蓄力', keys: '鼠标右键',
        text: '「长钉」右键开始蓄力，0.7 秒后松开发射高速弹，+20 过载。' +
          '蓄力时移速 -20%。先蓄一次力。',
        goal: '蓄力 1 次',
        tip: '蓄力会被打断（冲刺、技能会取消）；找掩体后面蓄。',
        done: (w, b) => w.rails - b.rails >= 1,
      }),
      S({
        id: 'rail', title: '蓄力命中', keys: '右键 · 提前量',
        text: '蓄力弹弹速极快，但仍然要算提前量。用蓄力弹命中 1 次。',
        goal: '蓄力弹命中 1 次',
        tip: '准星放在目标身前一点点，蓄满再松手。',
        done: (w, b) => w.railHits - b.railHits >= 1,
      }),
      S({
        id: 'far', title: '远程压制', keys: '12 米外',
        text: '「长钉」的战场在远处：站到 12 米开外，命中 2 次。',
        goal: '12 米外命中 2 次',
        tip: '远距离不要追着打，打完换位置——对面会来找你。',
        done: (w, b) => w.far12Hits - b.far12Hits >= 2,
      }),
      S({
        id: 'duel', title: '实战：点名', keys: '右键 + 左键',
        text: '靶机醒了，它会朝你冲。它靠近就按空格拉开距离，再用蓄力弹点名。击倒 1 台。',
        goal: '击倒 1 台 AI',
        tip: '被贴脸时蓄力是自杀：先冲刺，拉开 6 米再蓄。',
        done: (w, b) => w.kills - b.kills >= 1,
      }),
    ],
    advanced: [
      S({
        id: 'lead', title: '打横移的人', keys: '预判',
        text: '实战里没人站着让你打。用普通弹命中移动靶 3 次，练预判。',
        goal: '命中移动靶 3 次',
        tip: '提前量 = 目标速度 × 子弹飞行时间，越远越多。',
        done: (w, b) => w.moverHits - b.moverHits >= 3,
      }),
      S({
        id: 'heat', title: '蓄力控温', keys: '热量 < 60',
        text: '蓄力弹很烫，连发会把自己顶到 90。热量 60 以下命中 4 次。',
        goal: '热量 ≤ 60 时命中 4 次',
        tip: '打一发 → 退一步 → 再蓄，比站着连开稳。',
        done: (w, b) => w.coolHits - b.coolHits >= 4,
      }),
      S({
        id: 'win', title: '打赢两台', keys: '全部技巧',
        text: '两台 AI 会包夹你。保持 15 米距离，先打血少的，被贴脸就冲刺换位。击杀 2 台。',
        goal: '击杀 2 台 AI',
        tip: '你怕近身，所以永远站在「有退路」的那一侧。',
        done: (w, b) => w.kills - b.kills >= 2,
      }),
    ],
  },

  furnace: {
    tutorial: [
      S({
        id: 'skill', title: '认识引信', keys: '鼠标右键',
        text: '「炉心」右键点燃 3 秒引信：引信烧完你就短路自爆，范围内的敌人一起飞。' +
          '再按一次可以取消。先点燃一次。',
        goal: '点燃引信 1 次',
        tip: '被动「超限炉心」让爆炸范围 +50%——你是全场最大的一发子弹。',
        done: (w, b) => w.fuseStarts - b.fuseStarts >= 1,
      }),
      S({
        id: 'cancel', title: '学会取消', keys: '右键 ×2',
        text: '引信不是每次都要炸：位置不好、对面跑了，就取消。取消 1 次。',
        goal: '取消引信 1 次',
        tip: '取消只要 1 秒冷却，可以骗对面走位。',
        done: (w, b) => w.fuseCancels - b.fuseCancels >= 1,
      }),
      S({
        id: 'boom', title: '引爆命中', keys: '右键 · 贴身',
        text: '引爆的伤害就在你身边：冲进人堆再让它炸。引爆命中敌人 1 次。',
        goal: '自爆命中敌人 1 次',
        tip: '你自爆也会死，但短路是「换命」不是「输」——换到就是赚。',
        done: (w, b) => w.fuseHits - b.fuseHits >= 1,
      }),
      S({
        id: 'duel', title: '实战：换一条命', keys: '右键 · 3 秒',
        text: '靶机醒了。点燃引信冲向它，3 秒内追到就炸。用自爆击倒 1 台。',
        goal: '自爆击倒 1 台',
        tip: '引信 3 秒 ≈ 你跑 24 米，追得上任何机体。',
        done: (w, b) => w.selfKills - b.selfKills >= 1,
      }),
    ],
    advanced: [
      S({
        id: 'chain', title: '连环引爆', keys: '右键',
        text: '一局里靠自爆命中两次（可以不击杀，炸到就行）。',
        goal: '自爆命中 2 次',
        tip: '引爆后立刻重生，重生有 2 秒无敌——马上找下一个目标。',
        done: (w, b) => w.fuseHits - b.fuseHits >= 2,
      }),
      S({
        id: 'bait', title: '用引信逼走位', keys: '右键 → 取消',
        text: '点燃引信，把对面逼出掩体，然后取消，改用左键收掉。' +
          '这一局完成 2 次「点燃 → 取消 → 命中」。',
        goal: '引信逼位后命中 2 次',
        tip: '对面看到引信只会跑，逃跑路线是直线——最好打。',
        done: (w, b) => w.fuseBaits - b.fuseBaits >= 2,
      }),
      S({
        id: 'win', title: '打赢两台', keys: '全部技巧',
        text: '两台 AI。先炸掉一台，重生后趁无敌把第二台收掉。击杀 2 台。',
        goal: '击杀 2 台 AI',
        tip: '自爆炸死的人算你的击杀，所以「换命」在比分上是赚的。',
        done: (w, b) => w.kills - b.kills >= 2,
      }),
    ],
  },
};

export const LESSON_LEVELS = [
  { id: 'tutorial', label: '专属教程', desc: '技能 · 命中 · 机体脾气' },
  { id: 'advanced', label: '进阶玩法', desc: '连招 · 生存 · 打赢 AI' },
];

/** Title used by the tutorial panel and the HUD. */
export function lessonTitle(mechId, level) {
  const mech = MECHS[mechId] || MECHS.assault;
  return `${mech.name} · ${level === 'advanced' ? '进阶玩法' : '专属教程'}`;
}
