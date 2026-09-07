#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""《奇妙数学》分集内容：台词脚本 + 场景绘制 JS。
每集一个 key；scenes_js 里必须定义 const DRAW = {场景id: fn(g,p,t)}。
台词里 ⏸n 表示额外停 n 秒（留给孩子思考）。角色：N=旁白 L=灵灵 D=豆豆
⚠️ JS 模板字符串用原始反引号，不要转义。
"""

EPISODES = {}

# ============================================================ 第1集 分数
EPISODES["ep01"] = {
 "num": 1, "title": "第1集 分数是怎么来的", "sub": "一张披萨，讲明白分数",
 "quiz": {"q": "四分之三，是把一个东西平均分成几份，拿走其中几份？",
          "options": ["分成 3 份，拿走 4 份", "分成 4 份，拿走 3 份", "分成 7 份，拿走 3 份"],
          "answer": 1, "right": "答对了！分母 4 = 分成 4 份，分子 3 = 拿走 3 份。",
          "wrong": "再想想：下面的数是「分成几份」，上面的数是「拿走几份」。"},
 "script": [
  ("title","N","奇妙数学，第一集：分数是怎么来的。"),
  ("title","L","我是灵灵！"),
  ("title","D","我是豆豆！今天这个故事，要从一张披萨说起。"),
  ("half","N","豆豆买了一张披萨，正准备开吃，灵灵来了。"),
  ("half","L","豆豆，我也想吃！"),
  ("half","D","好吧，那我们一人一半。可是，怎么切才算公平呢？"),
  ("half","N","公平的意思是，两个人分到的一样多。所以要从正中间切一刀，把披萨分成一样大的两份。"),
  ("half","N","每个人拿到的，就是两份里的一份。数学上把它写成，二分之一。"),
  ("quarter","N","这时候，又来了两位朋友。"),
  ("quarter","D","四个人呀，那我再切一刀。"),
  ("quarter","N","现在披萨被平均分成了四份，每人拿到四份里的一份，也就是四分之一。"),
  ("quarter","L","分的人越多，每个人分到的就越小。"),
  ("note","N","你发现了吗？一个分数，其实是在说两件事。"),
  ("note","N","下面这个数，叫做分母，它告诉你，一共分成了几份。"),
  ("note","N","上面这个数，叫做分子，它告诉你，你拿走了其中的几份。"),
  ("note","L","所以四分之三，就是分成四份，拿走三份！"),
  ("note","N","完全正确。"),
  ("cmp","D","灵灵，我有个问题。二分之一和三分之一，哪个大呀？三比二大，是不是三分之一更大？"),
  ("cmp","N","这是很多人会掉进去的坑。我们把两张一样大的披萨摆在一起看看。"),
  ("cmp","N","左边这张分成两份，右边这张分成三份。看下面这两根条：分的份数越多，每一份反而越小。"),
  ("cmp","N","所以，二分之一比三分之一大。"),
  ("cmp","L","记住啦，分母越大，每一份越小！"),
  ("equal","N","再看一个有意思的。如果豆豆拿走了两个四分之一，他一共拿了多少？"),
  ("equal","D","两个四分之一，合起来，正好是半张！"),
  ("equal","N","没错。四分之二和二分之一，是一样多的。它们长得不一样，其实是同一个大小。"),
  ("life","N","分数不只藏在披萨里。半小时，就是二分之一小时。"),
  ("life","N","一刻钟，就是把一小时分成四份，取其中一份，也就是四分之一小时。"),
  ("life","N","半杯水，半张纸，半个苹果。分数，就藏在生活的每个角落。"),
  ("quiz","N","最后考考你：四分之三，是把一个东西平均分成几份，拿走其中的几份呢？⏸3.2"),
  ("quiz","N","答对啦。分成四份，拿走三份。"),
  ("quiz","L","我是灵灵！"),("quiz","D","我是豆豆！"),
  ("quiz","N","奇妙数学，下一集我们聊聊，为什么全世界都在用十个数字。我们下次见！"),
 ],
 "scenes_js": r"""
function dHalf(g,p,t){
  g.appendChild(txt(640,100,'一张披萨，两个人怎么分才公平？',42,'var(--ink)','middle',700));
  const push = p<.45?0:lerp(0,34,ease(clamp((p-.45)/.22,0,1)));
  pizza(g,600,400,168,p<.3?1:2,{pulled:[0,1],push});
  if(p>=.28&&p<.5){const k=clamp((p-.28)/.12,0,1);
    g.appendChild(el('line',{x1:600,y1:400-198,x2:600,y2:400-198+396*ease(k),
      stroke:'#eb5757','stroke-width':5,'stroke-linecap':'round','stroke-dasharray':'12 8'}));}
  if(p>.62){const o=clamp((p-.62)/.15,0,1);const gg=el('g',{opacity:o});
    frac(gg,1010,375,'1','2',86,'var(--teal)');
    gg.appendChild(txt(1010,540,'读作「二分之一」',26,'var(--ink2)','middle',600));
    gg.appendChild(txt(600,650,'每人分到 2 份中的 1 份',30,'var(--ink2)','middle',600));
    g.appendChild(gg);}
}
function dQuarter(g,p,t){
  g.appendChild(txt(640,100,'又来了两位朋友，四个人怎么分？',42,'var(--ink)','middle',700));
  const push=p<.45?0:lerp(0,32,ease(clamp((p-.45)/.2,0,1)));
  pizza(g,590,400,165,p<.28?2:4,{pulled:[0,1,2,3],push,hi:p>.6?[0]:[]});
  if(p>=.26&&p<.46){const k=clamp((p-.26)/.12,0,1);
    g.appendChild(el('line',{x1:590-198*ease(k),y1:400,x2:590+198*ease(k),y2:400,
      stroke:'#eb5757','stroke-width':5,'stroke-linecap':'round','stroke-dasharray':'12 8'}));}
  if(p>.58){const o=clamp((p-.58)/.15,0,1);const gg=el('g',{opacity:o});
    frac(gg,1010,375,'1','4',86,'var(--purple)');
    gg.appendChild(txt(1010,540,'每人 4 份中的 1 份',26,'var(--ink2)','middle',600));
    g.appendChild(gg);}
}
function dNote(g,p,t){
  g.appendChild(txt(640,96,'分数在说两件事',44,'var(--ink)','middle',700));
  frac(g,430,330,'3','4',150,'var(--ink)');
  if(p>.18){const gg=el('g',{opacity:clamp((p-.18)/.14,0,1)});
    gg.appendChild(el('path',{d:'M 660 420 L 540 392',stroke:'var(--teal)','stroke-width':4,fill:'none'}));
    gg.appendChild(txt(675,415,'分母：一共分成几份',34,'var(--teal)','start',700));g.appendChild(gg);}
  if(p>.42){const gg=el('g',{opacity:clamp((p-.42)/.14,0,1)});
    gg.appendChild(el('path',{d:'M 660 245 L 540 275',stroke:'var(--red)','stroke-width':4,fill:'none'}));
    gg.appendChild(txt(675,240,'分子：拿走了其中几份',34,'var(--red)','start',700));g.appendChild(gg);}
  if(p>.68){const gg=el('g',{opacity:clamp((p-.68)/.16,0,1)});
    pizza(gg,470,570,88,4,{hi:[0,1,2]});
    gg.appendChild(txt(620,585,'分成 4 份，拿走 3 份',32,'var(--ink2)','start',600));g.appendChild(gg);}
}
function dCmp(g,p,t){
  g.appendChild(txt(640,88,'二分之一 和 三分之一，哪个大？',42,'var(--ink)','middle',700));
  pizza(g,400,330,140,2,{hi:[0]}); pizza(g,880,330,140,3,{hi:[0]});
  frac(g,400,540,'1','2',56,'var(--orange)'); frac(g,880,540,'1','3',56,'var(--purple)');
  if(p>.42){const gg=el('g',{opacity:clamp((p-.42)/.18,0,1)});
    gg.appendChild(el('rect',{x:270,y:620,width:260,height:36,rx:8,fill:'#efe3d0'}));
    gg.appendChild(el('rect',{x:270,y:620,width:130,height:36,rx:8,fill:'var(--orange)'}));
    gg.appendChild(el('rect',{x:750,y:620,width:260,height:36,rx:8,fill:'#efe3d0'}));
    gg.appendChild(el('rect',{x:750,y:620,width:86.7,height:36,rx:8,fill:'var(--purple)'}));
    g.appendChild(gg);}
  if(p>.68){const gg=el('g',{opacity:clamp((p-.68)/.18,0,1)});
    gg.appendChild(el('rect',{x:300,y:118,width:680,height:62,rx:14,fill:'#fff2d8',
      stroke:'var(--gold)','stroke-width':3}));
    gg.appendChild(txt(640,160,'分的份数越多，每一份反而越小',34,'#a06a12','middle',700));g.appendChild(gg);}
}
function dEqual(g,p,t){
  g.appendChild(txt(640,96,'两个 四分之一 合起来，是多少？',42,'var(--ink)','middle',700));
  const push=p<.3?26:lerp(26,0,ease(clamp((p-.3)/.28,0,1)));
  pizza(g,400,380,152,4,{hi:[0,1],pulled:[0,1],push});
  frac(g,400,600,'2','4',58,'var(--orange)');
  if(p>.5){const o=clamp((p-.5)/.16,0,1);
    g.appendChild(el('g',{opacity:o})).appendChild(txt(640,398,'=',78,'var(--ink)','middle',700));
    const g2=el('g',{opacity:o}); pizza(g2,880,380,152,2,{hi:[0]});
    frac(g2,880,600,'1','2',58,'var(--teal)'); g.appendChild(g2);}
  if(p>.78){const gg=el('g',{opacity:clamp((p-.78)/.16,0,1)});
    gg.appendChild(txt(640,168,'长得不一样，其实一样大',34,'var(--green)','middle',700));g.appendChild(gg);}
}
function dLife(g,p,t){
  g.appendChild(txt(640,96,'分数就藏在生活里',44,'var(--ink)','middle',700));
  const clock=(cx,cy,r,n,label,col)=>{const gg=el('g');
    gg.appendChild(el('circle',{cx,cy,r,fill:'#fff',stroke:'#d9c7a8','stroke-width':6}));
    const a2=-Math.PI/2+2*Math.PI/n, p2=[cx+r*Math.cos(a2),cy+r*Math.sin(a2)];
    gg.appendChild(el('path',{d:`M ${cx} ${cy} L ${cx} ${cy-r} A ${r} ${r} 0 ${(2*Math.PI/n)>Math.PI?1:0} 1 ${p2[0]} ${p2[1]} Z`,
      fill:col,opacity:.82}));
    for(let i=0;i<12;i++){const a=-Math.PI/2+i*Math.PI/6;
      gg.appendChild(el('circle',{cx:cx+(r-14)*Math.cos(a),cy:cy+(r-14)*Math.sin(a),r:3,fill:'#b9a689'}));}
    gg.appendChild(txt(cx,cy+r+50,label,28,'var(--ink2)','middle',600)); return gg;};
  g.appendChild(clock(400,330,120,2,'半小时 = 1/2 小时','var(--orange)'));
  if(p>.35) g.appendChild(el('g',{opacity:clamp((p-.35)/.18,0,1)}))
    .appendChild(clock(880,330,120,4,'一刻钟 = 1/4 小时','var(--purple)'));
  if(p>.66){const gg=el('g',{opacity:clamp((p-.66)/.2,0,1)});
    gg.appendChild(txt(640,600,'半杯水 · 半张纸 · 半个苹果',34,'var(--ink)','middle',600));
    gg.appendChild(txt(640,656,'你今天用到过几个分数？',28,'var(--ink2)','middle',400));g.appendChild(gg);}
}
function dQuiz(g,p,t){
  g.appendChild(txt(640,116,'动动脑',42,'var(--orange)','middle',800));
  g.appendChild(txt(640,196,'四分之三，是分成几份、拿走几份？',42,'var(--ink)','middle',700));
  frac(g,640,350,'3','4',115,'var(--ink)');
  if(p>.30&&p<.52) g.appendChild(txt(640,540,'想一想'+'.'.repeat(1+Math.floor((t*2)%3)),36,'var(--ink2)','middle',600));
  if(p>=.52){const gg=el('g',{opacity:clamp((p-.52)/.14,0,1)});
    pizza(gg,440,560,92,4,{hi:[0,1,2]});
    gg.appendChild(txt(600,575,'分成 4 份，拿走 3 份',38,'var(--green)','start',700));g.appendChild(gg);}
}
const DRAW={title:(g,p,t)=>drawTitleScene(g,p,t,'第 1 集 · 分数是怎么来的','一张披萨，讲明白分数'),
  half:dHalf,quarter:dQuarter,note:dNote,cmp:dCmp,equal:dEqual,life:dLife,quiz:dQuiz};
""",
}

# ============================================================ 第2集 十进制
EPISODES["ep02"] = {
 "num": 2, "title": "第2集 为什么全世界都在用十个数字", "sub": "答案就长在你手上",
 "quiz": {"q": "305 里的 3，表示什么？",
          "options": ["3 个一", "3 个十", "3 个百"], "answer": 2,
          "right": "答对了！它站在百位上，所以是 3 个百，也就是 300。",
          "wrong": "再看一次数位：从右往左依次是个位、十位、百位。"},
 "script": [
  ("title","N","奇妙数学，第二集：为什么全世界都在用十个数字。"),
  ("title","D","灵灵，我一直有个问题。数字为什么只有零到九，一共十个呀？"),
  ("title","L","这个问题问得好。答案，就长在你自己身上。"),
  ("hand","N","你伸出两只手，数一数，一共有几根手指？"),
  ("hand","D","一、二、三……十！十根！"),
  ("hand","N","没错。在很久很久以前，人们还没有发明数字，数东西就靠掰手指。"),
  ("hand","N","十根手指数完了，就得从头再来。所以「十」，成了人类最自然的一个坎。"),
  ("count","N","我们来看看数到九以后会发生什么。"),
  ("count","N","一、二、三、四、五、六、七、八、九……然后呢？"),
  ("count","D","然后就没有新的数字啦！"),
  ("count","N","对。所以人们想出一个绝妙的办法：满十，就往前进一位。"),
  ("count","N","右边这一位归零，左边多出一个一。这就是十，一个十和零个一。"),
  ("place","N","这个办法厉害在哪里？同一个数字，站在不同的位置上，意思完全不一样。"),
  ("place","N","看这个数：二百三十五。右边第一位叫个位，第二位叫十位，第三位叫百位。"),
  ("place","N","所以它是两个百、三个十、五个一。"),
  ("place","L","位置决定大小，这就是数位的秘密。"),
  ("if8","N","那如果，人的手上不是十根手指呢？"),
  ("if8","D","要是只有八根，会怎么样？"),
  ("if8","N","那我们数到七就得进位，世界上就只会有零到七这八个数字。"),
  ("if8","N","十进制并不是天上掉下来的规矩，它只是因为，我们刚好有十根手指。"),
  ("big","N","有了这个办法，只用十个数字，我们就能写出任意大的数。"),
  ("big","N","十、一百、一千、一万，每往左一位，就大十倍。"),
  ("big","L","十个符号，写尽了整个宇宙的数。"),
  ("quiz","N","考考你：三百零五里面的三，表示的是什么呢？⏸3.2"),
  ("quiz","N","它站在百位上，所以是三个百，也就是三百。"),
  ("quiz","L","我是灵灵！"),("quiz","D","我是豆豆！"),
  ("quiz","N","下一集，我们去认识比零还小的数。我们下次见！"),
 ],
 "scenes_js": r"""
function hand(cx,cy,s,lit){   // lit = 点亮的手指数(0~5)
  const G=el('g',{transform:`translate(${cx},${cy}) scale(${s})`});
  G.appendChild(el('rect',{x:-52,y:-10,width:104,height:96,rx:34,fill:'#ffdfc4',stroke:'#e0a978','stroke-width':4}));
  for(let i=0;i<5;i++){
    const x=-42+i*21, h=(i===0?58:(i===2?86:(i===1||i===3?76:62)));
    G.appendChild(el('rect',{x:x-9,y:-h-6,width:19,height:h+16,rx:10,
      fill:i<lit?'#ffb45a':'#ffdfc4',stroke:'#e0a978','stroke-width':3.5}));
  }
  return G;
}
function dHand(g,p,t){
  g.appendChild(txt(640,92,'伸出手，数一数',44,'var(--ink)','middle',700));
  const n=Math.min(10,Math.floor(clamp((p-.18)/.42,0,1)*10+0.001));
  g.appendChild(hand(400,330,1.5,Math.min(5,n)));
  g.appendChild(hand(880,330,1.5,Math.max(0,n-5)));
  g.appendChild(txt(640,560,n>0?String(n):'',110,'var(--orange)','middle',800));
  if(p>.66) g.appendChild(txt(640,660,'十根手指数完，就得从头再来',34,'var(--ink2)','middle',600));
}
function dCount(g,p,t){
  g.appendChild(txt(640,96,'数到九以后，怎么办？',44,'var(--ink)','middle',700));
  const k=Math.min(9,Math.floor(clamp((p-.1)/.34,0,1)*10));
  for(let i=0;i<=9;i++){
    const x=180+i*104, on=(i<=k);
    g.appendChild(el('rect',{x:x-38,y:230,width:76,height:88,rx:12,
      fill:on?'#ffe6c2':'#fff',stroke:on?'var(--orange)':'#ddd0b8','stroke-width':on?4:2.5}));
    g.appendChild(txt(x,296,String(i),52,on?'var(--orange)':'#cbbba0','middle',800));
  }
  if(p>.5){const o=clamp((p-.5)/.14,0,1);
    g.appendChild(el('g',{opacity:o})).appendChild(txt(640,400,'没有第十一个数字了……',36,'var(--red)','middle',700));}
  if(p>.66){const o=clamp((p-.66)/.16,0,1);const gg=el('g',{opacity:o});
    gg.appendChild(txt(640,470,'满十进一',44,'var(--green)','middle',800));
    digitBoxes(gg,640,510,[1,0],['十位','个位'],96,0);
    g.appendChild(gg);}
}
function dPlace(g,p,t){
  g.appendChild(txt(640,92,'位置，决定了大小',44,'var(--ink)','middle',700));
  const hi = p<.34?2:(p<.56?1:(p<.78?0:null));
  digitBoxes(g,600,190,[2,3,5],['百位','十位','个位'],118,hi);
  const rows=[['2 个百','200','var(--purple)'],['3 个十','30','var(--teal)'],['5 个一','5','var(--orange)']];
  rows.forEach((r,i)=>{
    if(p>.30+i*0.22){const gg=el('g',{opacity:clamp((p-(.30+i*0.22))/.12,0,1)});
      gg.appendChild(txt(430,420+i*62,r[0],34,r[2],'end',700));
      gg.appendChild(txt(470,420+i*62,'=',30,'var(--ink2)','start',600));
      gg.appendChild(txt(530,420+i*62,r[1],34,r[2],'start',700));
      g.appendChild(gg);}
  });
  if(p>.86) g.appendChild(txt(760,480,'合起来 = 235',44,'var(--ink)','start',800));
}
function dIf8(g,p,t){
  g.appendChild(txt(640,92,'如果人只有八根手指呢？',44,'var(--ink)','middle',700));
  g.appendChild(hand(430,300,1.3,4)); g.appendChild(hand(850,300,1.3,4));
  if(p>.34){const gg=el('g',{opacity:clamp((p-.34)/.16,0,1)});
    for(let i=0;i<=7;i++){const x=300+i*98;
      gg.appendChild(el('rect',{x:x-36,y:470,width:72,height:80,rx:12,fill:'#ffe6c2',
        stroke:'var(--orange)','stroke-width':3}));
      gg.appendChild(txt(x,530,String(i),46,'var(--orange)','middle',800));}
    g.appendChild(gg);}
  if(p>.62){const gg=el('g',{opacity:clamp((p-.62)/.18,0,1)});
    gg.appendChild(txt(640,630,'数到七就进位，世界上只会有八个数字',34,'var(--ink2)','middle',600));
    g.appendChild(gg);}
}
function dBig(g,p,t){
  g.appendChild(txt(640,92,'十个符号，写尽所有的数',44,'var(--ink)','middle',700));
  const items=[['1','一'],['10','十'],['100','一百'],['1000','一千'],['10000','一万']];
  items.forEach((it,i)=>{
    if(p>.10+i*0.15){const o=clamp((p-(.10+i*0.15))/.1,0,1);
      const gg=el('g',{opacity:o});
      gg.appendChild(txt(230+i*210,330,it[0],i<3?58:46,'var(--teal)','middle',800));
      gg.appendChild(txt(230+i*210,392,it[1],28,'var(--ink2)','middle',600));
      if(i>0) gg.appendChild(txt(230+i*210-105,330,'×10',24,'var(--orange)','middle',700));
      g.appendChild(gg);}
  });
  if(p>.82) g.appendChild(txt(640,520,'每往左一位，就大十倍',40,'var(--green)','middle',700));
}
function dQuiz(g,p,t){
  g.appendChild(txt(640,116,'动动脑',42,'var(--orange)','middle',800));
  g.appendChild(txt(640,200,'305 里的 3，表示什么？',42,'var(--ink)','middle',700));
  digitBoxes(g,640,260,[3,0,5],['百位','十位','个位'],110,p>=.5?0:null);
  if(p>.28&&p<.5) g.appendChild(txt(640,520,'想一想'+'.'.repeat(1+Math.floor((t*2)%3)),36,'var(--ink2)','middle',600));
  if(p>=.5) g.appendChild(txt(640,530,'3 个百 = 300',46,'var(--green)','middle',800));
}
const DRAW={title:(g,p,t)=>drawTitleScene(g,p,t,'第 2 集 · 为什么全世界都在用十个数字','答案就长在你手上'),
  hand:dHand,count:dCount,place:dPlace,if8:dIf8,big:dBig,quiz:dQuiz};
""",
}

# ============================================================ 第3集 负数
EPISODES["ep03"] = {
 "num": 3, "title": "第3集 负数：比 0 还小的数", "sub": "数轴向左，还有一半世界",
 "quiz": {"q": "负 3 和 负 7，哪个大？",
          "options": ["负 7 大", "负 3 大", "一样大"], "answer": 1,
          "right": "答对了！数轴上越靠右越大，负 3 在负 7 的右边。",
          "wrong": "看数轴：越往左越小，负 7 比负 3 更靠左。"},
 "script": [
  ("title","N","奇妙数学，第三集：负数，比零还小的数。"),
  ("title","D","灵灵，零不是最小的数吗？还能有比零更小的？"),
  ("title","L","当然有。而且你每年冬天都见过它。"),
  ("cold","N","看这支温度计。零度以上，水是液体；零度以下，水会结冰。"),
  ("cold","N","如果今天是零下五度，我们就写成，负五度。"),
  ("cold","D","负五！原来那个小横杠是这个意思。"),
  ("line","N","我们把数排成一条线，这条线叫数轴。零站在中间。"),
  ("line","N","往右走是一、二、三，越走越大。"),
  ("line","N","那往左走呢？就是负一、负二、负三，越走越小。"),
  ("line","L","数轴向左，还藏着一半的世界。"),
  ("money","N","负数还有一个特别好懂的用法：欠钱。"),
  ("money","N","豆豆有五块钱，写成正五。如果他不但没钱，还欠了灵灵三块，就写成负三。"),
  ("money","D","那我要先还三块，才回到零。"),
  ("money","N","对。零，不是最小，零只是分界线。"),
  ("move","N","在数轴上，加法就是往右走，减法就是往左走。"),
  ("move","N","从二开始，减五，往左走五步，就到了负三。"),
  ("move","L","走过零，也不用停下来。"),
  ("cmp","D","那我再问一个：负三和负七，哪个大？"),
  ("cmp","N","很多人会说七比三大，所以负七大。但在数轴上，越靠右越大。"),
  ("cmp","N","负三在负七的右边，所以，负三更大。"),
  ("cmp","L","负数里，数字看起来越大，实际反而越小。"),
  ("quiz","N","考考你：负三和负七，到底哪个大呢？⏸3.2"),
  ("quiz","N","答案是负三。它离零更近，在数轴上更靠右。"),
  ("quiz","L","我是灵灵！"),("quiz","D","我是豆豆！"),
  ("quiz","N","下一集，我们聊聊三乘四为什么等于四乘三。我们下次见！"),
 ],
 "scenes_js": r"""
function dCold(g,p,t){
  g.appendChild(txt(640,92,'零度以下，怎么写？',44,'var(--ink)','middle',700));
  const v = lerp(12,-5,ease(clamp((p-.2)/.4,0,1)));
  thermo(g,430,360,300,v,{label:''});
  g.appendChild(txt(700,300,(v>=0?'':'-')+Math.abs(Math.round(v))+'°C',86,
    v<0?'var(--teal)':'var(--red)','start',800));
  if(p>.6){const gg=el('g',{opacity:clamp((p-.6)/.16,0,1)});
    gg.appendChild(txt(700,400,'零下五度 = 负五度',38,'var(--ink)','start',700));
    gg.appendChild(txt(700,462,'那个小横杠，就是「负」',30,'var(--ink2)','start',500));
    g.appendChild(gg);}
}
function dLine(g,p,t){
  g.appendChild(txt(640,96,'数轴：零站在中间',44,'var(--ink)','middle',700));
  numberLine(g,240,1040,340,{min:-5,max:5,step:1});
  if(p>.28){const gg=el('g',{opacity:clamp((p-.28)/.14,0,1)});
    gg.appendChild(el('path',{d:'M 700 250 L 1000 250',stroke:'var(--orange)','stroke-width':6,
      'stroke-linecap':'round'}));
    gg.appendChild(el('path',{d:'M 1000 250 l -20 -11 l 0 22 Z',fill:'var(--orange)'}));
    gg.appendChild(txt(850,225,'越走越大',30,'var(--orange)','middle',700));g.appendChild(gg);}
  if(p>.56){const gg=el('g',{opacity:clamp((p-.56)/.14,0,1)});
    gg.appendChild(el('path',{d:'M 580 250 L 280 250',stroke:'var(--teal)','stroke-width':6,
      'stroke-linecap':'round'}));
    gg.appendChild(el('path',{d:'M 280 250 l 20 -11 l 0 22 Z',fill:'var(--teal)'}));
    gg.appendChild(txt(430,225,'越走越小',30,'var(--teal)','middle',700));g.appendChild(gg);}
  if(p>.8) g.appendChild(txt(640,500,'数轴向左，还藏着一半的世界',36,'var(--green)','middle',700));
}
function dMoney(g,p,t){
  g.appendChild(txt(640,92,'欠钱，也是负数',44,'var(--ink)','middle',700));
  const coin=(x,y,n,col)=>{const gg=el('g');
    for(let i=0;i<Math.abs(n);i++){
      gg.appendChild(el('circle',{cx:x+(i%5)*54,cy:y+Math.floor(i/5)*54,r:23,
        fill:col,stroke:'#c9992e','stroke-width':3}));
      gg.appendChild(txt(x+(i%5)*54,y+Math.floor(i/5)*54+9,'1',24,'#7a5b12','middle',700));}
    return gg;};
  g.appendChild(txt(360,220,'豆豆有 5 块',32,'var(--ink2)','middle',600));
  g.appendChild(coin(270,290,5,'var(--gold)'));
  g.appendChild(txt(360,400,'+5',66,'var(--green)','middle',800));
  if(p>.4){const gg=el('g',{opacity:clamp((p-.4)/.16,0,1)});
    gg.appendChild(txt(900,220,'欠灵灵 3 块',32,'var(--ink2)','middle',600));
    const c=coin(810,290,3,'#e3e8ee'); c.setAttribute('opacity','.75'); gg.appendChild(c);
    gg.appendChild(txt(900,400,'-3',66,'var(--teal)','middle',800));g.appendChild(gg);}
  if(p>.72) g.appendChild(txt(640,520,'零不是最小，零只是分界线',38,'var(--green)','middle',700));
}
function dMove(g,p,t){
  g.appendChild(txt(640,92,'加法往右走，减法往左走',44,'var(--ink)','middle',700));
  const from=2, to=-3;
  const q=ease(clamp((p-.25)/.45,0,1));
  const v=lerp(from,to,q);
  const X=numberLine(g,240,1040,360,{min:-6,max:6,step:1,dot:v});
  g.appendChild(txt(640,200,'2 - 5 = ?',54,'var(--ink)','middle',800));
  if(p>.25&&p<.72){
    g.appendChild(el('path',{d:`M ${X(from)} 300 L ${X(v)} 300`,stroke:'var(--red)','stroke-width':5}));
    g.appendChild(txt((X(from)+X(v))/2,278,'往左 5 步',28,'var(--red)','middle',700));}
  if(p>.74) g.appendChild(txt(640,500,'2 - 5 = -3',54,'var(--green)','middle',800));
}
function dCmp(g,p,t){
  g.appendChild(txt(640,92,'负 3 和 负 7，哪个大？',44,'var(--ink)','middle',700));
  numberLine(g,240,1040,340,{min:-8,max:2,step:1,hi:[-3,-7]});
  if(p>.3){const gg=el('g',{opacity:clamp((p-.3)/.15,0,1)});
    gg.appendChild(el('circle',{cx:240+((-7)+8)/10*800,cy:340,r:16,fill:'var(--teal)'}));
    gg.appendChild(el('circle',{cx:240+((-3)+8)/10*800,cy:340,r:16,fill:'var(--orange)'}));
    g.appendChild(gg);}
  if(p>.52){const gg=el('g',{opacity:clamp((p-.52)/.16,0,1)});
    gg.appendChild(el('path',{d:'M 700 230 L 1000 230',stroke:'var(--green)','stroke-width':5}));
    gg.appendChild(el('path',{d:'M 1000 230 l -20 -11 l 0 22 Z',fill:'var(--green)'}));
    gg.appendChild(txt(850,208,'越靠右越大',30,'var(--green)','middle',700));g.appendChild(gg);}
  if(p>.74) g.appendChild(txt(640,510,'-3 > -7',60,'var(--green)','middle',800));
  if(p>.86) g.appendChild(txt(640,580,'负数里，数字越大反而越小',32,'var(--ink2)','middle',600));
}
function dQuiz(g,p,t){
  g.appendChild(txt(640,116,'动动脑',42,'var(--orange)','middle',800));
  g.appendChild(txt(640,200,'负 3 和 负 7，哪个大？',44,'var(--ink)','middle',700));
  numberLine(g,280,1000,360,{min:-8,max:0,step:1,hi:[-3,-7]});
  if(p>.28&&p<.5) g.appendChild(txt(640,520,'想一想'+'.'.repeat(1+Math.floor((t*2)%3)),36,'var(--ink2)','middle',600));
  if(p>=.5) g.appendChild(txt(640,530,'-3 更大（它离 0 更近）',46,'var(--green)','middle',800));
}
const DRAW={title:(g,p,t)=>drawTitleScene(g,p,t,'第 3 集 · 负数：比 0 还小的数','数轴向左，还有一半世界'),
  cold:dCold,line:dLine,money:dMoney,move:dMove,cmp:dCmp,quiz:dQuiz};
""",
}

# ============================================================ 第4集 乘法交换律
EPISODES["ep04"] = {
 "num": 4, "title": "第4集 3×4 为什么等于 4×3", "sub": "把它摆出来就懂了",
 "quiz": {"q": "不用算，6×7 和 7×6 哪个大？",
          "options": ["6×7 大", "7×6 大", "一样大"], "answer": 2,
          "right": "答对了！把点阵转个方向，个数一点没变。",
          "wrong": "想想那个点阵：转 90 度，点还是那些点。"},
 "script": [
  ("title","N","奇妙数学，第四集：三乘四，为什么等于四乘三。"),
  ("title","D","灵灵，我背口诀的时候老是想不通。三四十二，四三也十二，这是巧合吗？"),
  ("title","L","一点都不巧。把它摆出来，你一眼就懂了。"),
  ("array","N","我们先来摆三乘四。三行，每行四个。"),
  ("array","N","一行四个，两行八个，三行十二个。一共十二个。"),
  ("array","D","三乘四等于十二，没错。"),
  ("rotate","N","现在，我们把这堆点，整个转九十度。"),
  ("rotate","N","注意看，一个点也没有增加，一个点也没有减少。"),
  ("rotate","N","可是现在它变成了四行，每行三个，也就是四乘三。"),
  ("rotate","D","点还是那些点！所以它们当然一样多！"),
  ("why","N","这就是乘法的一个规律：交换两个数的位置，结果不变。"),
  ("why","N","数学上把它叫做乘法交换律。"),
  ("why","L","因为乘法算的是「一共有多少个」，跟你从哪个方向数没有关系。"),
  ("life","N","生活里到处是这个道理。一板巧克力，横着数六排，竖着数四列。"),
  ("life","N","你说它是六乘四，还是四乘六？都对，因为巧克力就那么多块。"),
  ("life","D","那我背口诀只要背一半就够了！"),
  ("life","N","聪明。九九乘法表里，一半的算式其实是另一半转过来的。"),
  ("quiz","N","考考你：不用算，六乘七和七乘六，哪个大？⏸3.2"),
  ("quiz","N","一样大。转个方向而已，个数从来没变。"),
  ("quiz","L","我是灵灵！"),("quiz","D","我是豆豆！"),
  ("quiz","N","下一集，我们聊聊面积为什么是长乘宽。我们下次见！"),
 ],
 "scenes_js": r"""
function dArray(g,p,t){
  g.appendChild(txt(640,92,'先摆一摆 3 × 4',44,'var(--ink)','middle',700));
  const total=12, show=Math.min(total,Math.floor(clamp((p-.12)/.42,0,1)*total+0.001));
  grid(g,430,220,3,4,{cell:70,gap:16,shape:'dot',show});
  g.appendChild(txt(830,300,'3 行',34,'var(--ink2)','start',600));
  g.appendChild(txt(830,360,'每行 4 个',34,'var(--ink2)','start',600));
  if(show>0) g.appendChild(txt(880,470,String(show),72,'var(--orange)','middle',800));
  if(p>.62) g.appendChild(txt(640,600,'3 × 4 = 12',56,'var(--teal)','middle',800));
}
function dRotate(g,p,t){
  g.appendChild(txt(640,92,'把它转 90 度',44,'var(--ink)','middle',700));
  const a=lerp(0,90,ease(clamp((p-.2)/.4,0,1)));
  const G=el('g',{transform:`rotate(${a} 640 380)`});
  grid(G,517,294,3,4,{cell:70,gap:16,shape:'dot'});
  g.appendChild(G);
  if(p>.66){const gg=el('g',{opacity:clamp((p-.66)/.14,0,1)});
    gg.appendChild(txt(640,620,'4 行，每行 3 个 → 4 × 3 = 12',44,'var(--teal)','middle',800));
    g.appendChild(gg);}
  if(p>.84) g.appendChild(txt(640,180,'一个点都没多，一个点都没少',32,'var(--green)','middle',700));
}
function dWhy(g,p,t){
  g.appendChild(txt(640,110,'乘法交换律',48,'var(--orange)','middle',800));
  grid(g,220,240,3,4,{cell:52,gap:12,shape:'dot'});
  g.appendChild(txt(350,510,'3 × 4',48,'var(--teal)','middle',800));
  if(p>.3){const gg=el('g',{opacity:clamp((p-.3)/.14,0,1)});
    gg.appendChild(txt(640,400,'=',64,'var(--ink)','middle',800));g.appendChild(gg);}
  if(p>.44){const gg=el('g',{opacity:clamp((p-.44)/.16,0,1)});
    grid(gg,790,214,4,3,{cell:52,gap:12,shape:'dot'});
    gg.appendChild(txt(890,510,'4 × 3',48,'var(--purple)','middle',800));g.appendChild(gg);}
  if(p>.7){const gg=el('g',{opacity:clamp((p-.7)/.16,0,1)});
    gg.appendChild(el('rect',{x:300,y:570,width:680,height:64,rx:16,fill:'#fff2d8',
      stroke:'var(--gold)','stroke-width':3}));
    gg.appendChild(txt(640,613,'交换位置，结果不变',36,'#a06a12','middle',700));g.appendChild(gg);}
}
function dLife(g,p,t){
  g.appendChild(txt(640,92,'一板巧克力，横着数还是竖着数？',42,'var(--ink)','middle',700));
  const gg=el('g',{transform:'translate(0,0)'});
  grid(gg,380,200,4,6,{cell:76,gap:10,shape:'box'});
  g.appendChild(gg);
  if(p>.3) g.appendChild(txt(330,300,'4 排',34,'var(--purple)','end',700));
  if(p>.44) g.appendChild(txt(640,570,'6 列',34,'var(--teal)','middle',700));
  if(p>.6){const q=el('g',{opacity:clamp((p-.6)/.16,0,1)});
    q.appendChild(txt(640,640,'6 × 4 = 4 × 6 = 24',48,'var(--green)','middle',800));g.appendChild(q);}
  if(p>.82) g.appendChild(txt(640,150,'九九表里，一半算式是另一半转过来的',30,'var(--ink2)','middle',600));
}
function dQuiz(g,p,t){
  g.appendChild(txt(640,116,'动动脑',42,'var(--orange)','middle',800));
  g.appendChild(txt(640,196,'不用算：6 × 7 和 7 × 6，哪个大？',42,'var(--ink)','middle',700));
  grid(g,330,250,6,7,{cell:34,gap:8,shape:'dot'});
  if(p>.28&&p<.5) g.appendChild(txt(900,420,'想一想'+'.'.repeat(1+Math.floor((t*2)%3)),34,'var(--ink2)','middle',600));
  if(p>=.5) g.appendChild(txt(900,420,'一样大',56,'var(--green)','middle',800));
}
const DRAW={title:(g,p,t)=>drawTitleScene(g,p,t,'第 4 集 · 3×4 为什么等于 4×3','把它摆出来就懂了'),
  array:dArray,rotate:dRotate,why:dWhy,life:dLife,quiz:dQuiz};
""",
}

# ============================================================ 第5集 面积
EPISODES["ep05"] = {
 "num": 5, "title": "第5集 面积：为什么是长乘宽", "sub": "用小方块把它铺满",
 "quiz": {"q": "一个长 6、宽 2 的长方形，面积是多少？",
          "options": ["8", "12", "16"], "answer": 1,
          "right": "答对了！每行 6 块，铺 2 行，一共 12 块。",
          "wrong": "别把周长和面积搞混：面积是数「铺满要几块」。"},
 "script": [
  ("title","N","奇妙数学，第五集：面积，为什么是长乘宽。"),
  ("title","D","灵灵，老师说长方形面积等于长乘宽。可是为什么呀？"),
  ("title","L","因为面积这件事，本来就是在数方块。"),
  ("tile","N","我们先说清楚，面积到底是什么。"),
  ("tile","N","面积就是：这个图形，能装下多少个一乘一的小方块。"),
  ("tile","N","看，我们一块一块地把这个长方形铺满。"),
  ("count","D","我来数！一、二、三……哎，太慢了。"),
  ("count","N","别一个一个数。先看一行，一行正好铺五块。"),
  ("count","N","再看有几行，一共三行。"),
  ("count","N","三行，每行五块，就是五乘三，等于十五块。"),
  ("formula","N","看出来了吗？一行几块，由长决定；有几行，由宽决定。"),
  ("formula","N","所以，长乘宽，算的就是一共有多少个小方块。"),
  ("formula","L","公式不是背下来的，是数出来的。"),
  ("trap","N","这里有个特别容易搞混的地方：周长和面积，完全不是一回事。"),
  ("trap","N","这两个长方形，周长一样长，都是十六。"),
  ("trap","N","可是左边这个能铺十五块，右边这个只能铺七块。"),
  ("trap","D","周长一样，面积差这么多！"),
  ("trap","N","周长是绕着边走一圈有多远，面积是里面能装多少。"),
  ("quiz","N","考考你：一个长六、宽二的长方形，面积是多少？⏸3.2"),
  ("quiz","N","每行六块，铺两行，一共十二块。"),
  ("quiz","L","我是灵灵！"),("quiz","D","我是豆豆！"),
  ("quiz","N","下一集，我们聊聊平均数，怎样才算公平。我们下次见！"),
 ],
 "scenes_js": r"""
function dTile(g,p,t){
  g.appendChild(txt(640,92,'面积，就是能装下多少小方块',42,'var(--ink)','middle',700));
  const total=15, show=Math.min(total,Math.floor(clamp((p-.25)/.5,0,1)*total+0.001));
  g.appendChild(el('rect',{x:395,y:225,width:490,height:290,rx:10,fill:'#fff',
    stroke:'var(--ink)','stroke-width':5}));
  grid(g,400,230,3,5,{cell:88,gap:8,shape:'box',show});
  g.appendChild(txt(640,600,'1 × 1 的小方块，一块一块铺满',32,'var(--ink2)','middle',600));
}
function dCount(g,p,t){
  g.appendChild(txt(640,92,'别一个一个数',44,'var(--ink)','middle',700));
  grid(g,400,220,3,5,{cell:88,gap:8,shape:'box',hiRow:p<.4?0:null,hiCol:(p>=.4&&p<.66)?0:null});
  if(p>.16&&p<.42) g.appendChild(txt(920,290,'一行 5 块',36,'var(--orange)','start',700));
  if(p>.42&&p<.7) g.appendChild(txt(920,360,'一共 3 行',36,'var(--orange)','start',700));
  if(p>.7){const gg=el('g',{opacity:clamp((p-.7)/.16,0,1)});
    gg.appendChild(txt(640,620,'5 × 3 = 15 块',54,'var(--teal)','middle',800));g.appendChild(gg);}
}
function dFormula(g,p,t){
  g.appendChild(txt(640,92,'公式是数出来的',44,'var(--ink)','middle',700));
  grid(g,360,200,3,5,{cell:80,gap:8,shape:'box'});
  g.appendChild(el('path',{d:'M 360 480 L 800 480',stroke:'var(--teal)','stroke-width':5,'stroke-linecap':'round'}));
  g.appendChild(txt(580,520,'长 = 5（一行几块）',30,'var(--teal)','middle',700));
  g.appendChild(el('path',{d:'M 320 200 L 320 460',stroke:'var(--purple)','stroke-width':5,'stroke-linecap':'round'}));
  g.appendChild(txt(230,340,'宽 = 3',30,'var(--purple)','middle',700));
  g.appendChild(txt(230,382,'（几行）',26,'var(--purple)','middle',500));
  if(p>.5){const gg=el('g',{opacity:clamp((p-.5)/.18,0,1)});
    gg.appendChild(el('rect',{x:850,y:250,width:340,height:150,rx:16,fill:'#fff2d8',
      stroke:'var(--gold)','stroke-width':3}));
    gg.appendChild(txt(1020,320,'面积 = 长 × 宽',34,'#a06a12','middle',800));
    gg.appendChild(txt(1020,368,'= 5 × 3 = 15',30,'#a06a12','middle',700));g.appendChild(gg);}
}
function dTrap(g,p,t){
  g.appendChild(txt(640,88,'周长一样，面积可以差很多',42,'var(--ink)','middle',700));
  grid(g,180,190,3,5,{cell:62,gap:6,shape:'box'});
  g.appendChild(txt(350,470,'5 × 3 = 15 块',32,'var(--teal)','middle',700));
  g.appendChild(txt(350,520,'周长 16',28,'var(--ink2)','middle',600));
  if(p>.35){const gg=el('g',{opacity:clamp((p-.35)/.16,0,1)});
    grid(gg,800,190,1,7,{cell:62,gap:6,shape:'box'});
    gg.appendChild(txt(1010,470,'7 × 1 = 7 块',32,'var(--purple)','middle',700));
    gg.appendChild(txt(1010,520,'周长 16',28,'var(--ink2)','middle',600));g.appendChild(gg);}
  if(p>.66){const gg=el('g',{opacity:clamp((p-.66)/.18,0,1)});
    gg.appendChild(txt(640,610,'周长是走一圈多远，面积是里面装多少',34,'var(--green)','middle',700));
    g.appendChild(gg);}
}
function dQuiz(g,p,t){
  g.appendChild(txt(640,116,'动动脑',42,'var(--orange)','middle',800));
  g.appendChild(txt(640,196,'长 6、宽 2 的长方形，面积是多少？',42,'var(--ink)','middle',700));
  if(p>=.5) grid(g,380,260,2,6,{cell:80,gap:8,shape:'box'});
  else g.appendChild(el('rect',{x:380,y:260,width:6*88-8,height:2*88-8,rx:10,fill:'#fff',
    stroke:'var(--ink)','stroke-width':5}));
  if(p>.28&&p<.5) g.appendChild(txt(640,560,'想一想'+'.'.repeat(1+Math.floor((t*2)%3)),36,'var(--ink2)','middle',600));
  if(p>=.5) g.appendChild(txt(640,560,'6 × 2 = 12 块',52,'var(--green)','middle',800));
}
const DRAW={title:(g,p,t)=>drawTitleScene(g,p,t,'第 5 集 · 面积：为什么是长乘宽','用小方块把它铺满'),
  tile:dTile,count:dCount,formula:dFormula,trap:dTrap,quiz:dQuiz};
""",
}

# ============================================================ 第6集 平均数
EPISODES["ep06"] = {
 "num": 6, "title": "第6集 平均数：怎样才算公平", "sub": "把高的削平，把低的填满",
 "quiz": {"q": "3 个人分别有 2、4、9 颗糖，平均每人几颗？",
          "options": ["4 颗", "5 颗", "6 颗"], "answer": 1,
          "right": "答对了！2+4+9=15，15÷3=5。",
          "wrong": "先把糖全倒在一起数总数，再除以人数。"},
 "script": [
  ("title","N","奇妙数学，第六集：平均数，怎样才算公平。"),
  ("title","D","灵灵，我们三个人分糖，有人多有人少，怎么办？"),
  ("title","L","那就把它们抹平。这就是平均数在干的事。"),
  ("unfair","N","看这三堆糖。豆豆有八颗，灵灵有五颗，小朋友只有两颗。"),
  ("unfair","D","这也太不公平了吧！"),
  ("unfair","N","别急，我们来做一件事：把多的分给少的。"),
  ("flat","N","豆豆多出来的，匀一点给最少的那个。"),
  ("flat","N","再匀一点。你看，三堆慢慢变得一样高了。"),
  ("flat","N","最后每个人都是五颗。五，就是这三个数的平均数。"),
  ("flat","L","平均数，就是把高的削平，把低的填满以后的那个高度。"),
  ("formula","N","不用真的一颗一颗挪，有个更快的办法。"),
  ("formula","N","先把所有糖倒在一起：八加五加二，一共十五颗。"),
  ("formula","N","再平均分给三个人：十五除以三，等于五。"),
  ("formula","L","总数除以个数，就是平均数。"),
  ("trap","N","不过，平均数也会骗人。"),
  ("trap","N","看这五个人的零花钱：四个人都是十块，有一个人是两百块。"),
  ("trap","N","算出来平均是四十八块。可是五个人里，有四个人根本没有四十八。"),
  ("trap","D","平均数被那一个大数字拉走了！"),
  ("trap","N","所以看到平均数的时候，多问一句：里面有没有特别大的那一个。"),
  ("quiz","N","考考你：三个人分别有二、四、九颗糖，平均每人几颗？⏸3.5"),
  ("quiz","N","二加四加九等于十五，十五除以三，等于五颗。"),
  ("quiz","L","我是灵灵！"),("quiz","D","我是豆豆！"),
  ("quiz","N","奇妙数学，我们下次见！"),
 ],
 "scenes_js": r"""
function dUnfair(g,p,t){
  g.appendChild(txt(640,92,'三堆糖，公平吗？',44,'var(--ink)','middle',700));
  bars(g,330,520,[8,5,2],{w:110,gap:110,unit:38,names:['豆豆','灵灵','小朋友'],
    colors:['#9dcc52','#5aa9e6','#f2994a']});
  if(p>.55) g.appendChild(txt(640,630,'把多的分给少的，会怎么样？',34,'var(--ink2)','middle',600));
}
function dFlat(g,p,t){
  g.appendChild(txt(640,92,'把高的削平，把低的填满',44,'var(--ink)','middle',700));
  const q=ease(clamp((p-.12)/.55,0,1));
  const v=[lerp(8,5,q),5,lerp(2,5,q)];
  bars(g,330,520,v,{w:110,gap:110,unit:38,names:['豆豆','灵灵','小朋友'],
    colors:['#9dcc52','#5aa9e6','#f2994a']});
  if(q>0.02){const y=520-5*38;
    g.appendChild(el('line',{x1:290,y1:y,x2:1000,y2:y,stroke:'var(--red)','stroke-width':4,
      'stroke-dasharray':'12 8'}));
    g.appendChild(txt(1015,y+10,'5',40,'var(--red)','start',800));}
  if(p>.72) g.appendChild(txt(640,630,'每人 5 颗 —— 5 就是平均数',38,'var(--green)','middle',700));
}
function dFormula(g,p,t){
  g.appendChild(txt(640,96,'更快的办法',44,'var(--ink)','middle',700));
  g.appendChild(txt(640,230,'8 + 5 + 2 = 15',56,'var(--teal)','middle',800));
  if(p>.32) g.appendChild(el('g',{opacity:clamp((p-.32)/.16,0,1)}))
    .appendChild(txt(640,340,'15 ÷ 3 = 5',56,'var(--orange)','middle',800));
  if(p>.6){const gg=el('g',{opacity:clamp((p-.6)/.18,0,1)});
    gg.appendChild(el('rect',{x:300,y:420,width:680,height:80,rx:18,fill:'#fff2d8',
      stroke:'var(--gold)','stroke-width':3}));
    gg.appendChild(txt(640,474,'平均数 = 总数 ÷ 个数',42,'#a06a12','middle',800));g.appendChild(gg);}
}
function dTrap(g,p,t){
  g.appendChild(txt(640,88,'平均数也会骗人',44,'var(--red)','middle',700));
  const v=[10,10,10,10,200];
  const unit=1.7;
  bars(g,300,520,v,{w:84,gap:56,unit,names:['A','B','C','D','E'],
    colors:['#5aa9e6','#5aa9e6','#5aa9e6','#5aa9e6','#eb5757']});
  if(p>.4){const y=520-48*unit;
    g.appendChild(el('line',{x1:260,y1:y,x2:1010,y2:y,stroke:'var(--orange)','stroke-width':4,
      'stroke-dasharray':'12 8'}));
    g.appendChild(txt(1025,y+8,'平均 48',30,'var(--orange)','start',700));}
  if(p>.62) g.appendChild(txt(640,620,'5 个人里，4 个人根本没有 48',34,'var(--ink2)','middle',600));
  if(p>.84) g.appendChild(txt(640,168,'看到平均数，先问：有没有特别大的那一个',30,'var(--green)','middle',700));
}
function dQuiz(g,p,t){
  g.appendChild(txt(640,116,'动动脑',42,'var(--orange)','middle',800));
  g.appendChild(txt(640,196,'2、4、9 颗糖，平均每人几颗？',42,'var(--ink)','middle',700));
  bars(g,420,500,[2,4,9],{w:96,gap:96,unit:26,names:['2 颗','4 颗','9 颗'],
    colors:['#f2994a','#5aa9e6','#9dcc52']});
  if(p>.28&&p<.52) g.appendChild(txt(640,600,'想一想'+'.'.repeat(1+Math.floor((t*2)%3)),36,'var(--ink2)','middle',600));
  if(p>=.52) g.appendChild(txt(640,600,'(2+4+9) ÷ 3 = 5 颗',48,'var(--green)','middle',800));
}
const DRAW={title:(g,p,t)=>drawTitleScene(g,p,t,'第 6 集 · 平均数：怎样才算公平','把高的削平，把低的填满'),
  unfair:dUnfair,flat:dFlat,formula:dFormula,trap:dTrap,quiz:dQuiz};
""",
}
