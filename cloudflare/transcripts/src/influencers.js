/**
 * Landing page publica do programa de influenciadores da Vook Store.
 *
 * Sem JavaScript e sem dependencias externas: a pagina compartilha o mesmo
 * perfil de seguranca e desempenho dos documentos juridicos, mas possui uma
 * narrativa propria, voltada a apresentar o programa e levar ao Discord.
 */

export const INFLUENCER_SLUG = 'influenciadores';

const STORE_NAME = 'Vook Store';

const ICONS = {
  arrow:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M14 7l5 5-5 5"/></svg>',
  spark:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8c.5 5.2 3.2 8 8.4 8.5-5.2.5-7.9 3.3-8.4 8.5-.5-5.2-3.2-8-8.4-8.5 5.2-.5 7.9-3.3 8.4-8.5Z"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 4 4 8-9"/></svg>',
  video:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="13" height="14" rx="2"/><path d="m16.5 10 4-2v8l-4-2z"/></svg>',
  users:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.4-3.7 2.2-5.5 5.5-5.5s5.1 1.8 5.5 5.5M16 6.5a2.5 2.5 0 0 1 0 5M16.2 14c2.6.2 4 1.8 4.3 5"/></svg>',
  bag:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 12H6zM9 9V6a3 3 0 0 1 6 0v3"/></svg>',
  eye:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.8 12s3.2-5 9.2-5 9.2 5 9.2 5-3.2 5-9.2 5-9.2-5-9.2-5Z"/><circle cx="12" cy="12" r="2.5"/></svg>',
};

const CSS = `
:root{color-scheme:dark;--black:#050505;--ink:#0a0a0a;--card:#111;--card-2:#151515;
  --white:#fff;--text:#e8e8e8;--muted:#a4a4a4;--quiet:#6e6e6e;
  --line:rgba(255,255,255,.1);--line-strong:rgba(255,255,255,.24);--max:1180px}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:90px}
body{margin:0;min-width:320px;background:var(--black);color:var(--text);
  font-family:Inter,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.65;
  -webkit-font-smoothing:antialiased;overflow-x:hidden}
a{color:inherit;text-decoration:none}
a:focus-visible{outline:2px solid #fff;outline-offset:4px;border-radius:7px}
::selection{background:#fff;color:#050505}
.skip{position:fixed;z-index:50;top:10px;left:10px;transform:translateY(-160%);padding:10px 14px;
  border-radius:9px;background:#fff;color:#050505;font-weight:750}.skip:focus{transform:none}
.ambient{position:fixed;inset:0;z-index:-2;pointer-events:none;overflow:hidden;
  background:linear-gradient(180deg,#080808,#050505 38%,#070707)}
.ambient::before{content:"";position:absolute;inset:-20%;opacity:.22;
  background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),
    linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);
  background-size:72px 72px;transform:perspective(720px) rotateX(65deg) translateY(-20%);
  mask-image:linear-gradient(#000,transparent 62%)}
.ambient::after{content:"";position:absolute;width:760px;height:760px;left:50%;top:-560px;
  transform:translateX(-50%);border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.12),transparent 68%);
  animation:breathe 8s ease-in-out infinite alternate}
@keyframes breathe{to{transform:translateX(-50%) scale(1.12);opacity:.72}}
.orb{position:absolute;border-radius:50%;filter:blur(2px);opacity:.45;will-change:transform}
.orb-a{width:460px;height:460px;right:-270px;top:22%;border:1px solid rgba(255,255,255,.1);
  background:radial-gradient(circle at 34% 34%,rgba(255,255,255,.09),transparent 66%);animation:drift-a 18s ease-in-out infinite alternate}
.orb-b{width:320px;height:320px;left:-190px;top:62%;border:1px solid rgba(255,255,255,.08);
  background:radial-gradient(circle at 70% 30%,rgba(255,255,255,.07),transparent 68%);animation:drift-b 15s ease-in-out infinite alternate}
.beam{position:absolute;width:24vw;height:150vh;left:44%;top:-25%;transform:rotate(19deg);opacity:.16;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.08),transparent);filter:blur(24px);animation:beam 12s ease-in-out infinite alternate}
@keyframes drift-a{to{transform:translate(-90px,110px) scale(.86)}}
@keyframes drift-b{to{transform:translate(120px,-70px) scale(1.15)}}
@keyframes beam{to{transform:translateX(18vw) rotate(19deg);opacity:.28}}

.top{position:sticky;top:0;z-index:30;border-bottom:1px solid var(--line);background:rgba(5,5,5,.76);
  backdrop-filter:blur(20px) saturate(130%);-webkit-backdrop-filter:blur(20px) saturate(130%)}
.top-in{max-width:var(--max);height:68px;margin:auto;padding:0 24px;display:flex;align-items:center;gap:28px}
.brand{color:#fff;font-size:12px;font-weight:800;letter-spacing:.09em;text-transform:uppercase}
.nav{margin-left:auto;display:flex;align-items:center;gap:4px}
.nav a{padding:9px 12px;border-radius:9px;color:#999;font-size:12px;font-weight:600;transition:.2s}
.nav a:hover{color:#fff;background:rgba(255,255,255,.05)}
.nav .active{color:#fff;background:rgba(255,255,255,.08)}

.container{max-width:var(--max);margin:auto;padding-left:24px;padding-right:24px}
.hero{min-height:calc(100vh - 68px);display:grid;grid-template-columns:minmax(0,1.05fr) minmax(380px,.72fr);
  gap:72px;align-items:center;padding-top:64px;padding-bottom:72px}
.kicker{display:inline-flex;align-items:center;gap:9px;margin:0 0 26px;padding:7px 10px;border:1px solid var(--line);
  border-radius:999px;background:rgba(255,255,255,.035);color:#cfcfcf;font-size:10px;font-weight:750;
  letter-spacing:.14em;text-transform:uppercase}
.live-dot{width:6px;height:6px;border-radius:50%;background:#fff;box-shadow:0 0 12px rgba(255,255,255,.75);
  animation:pulse 2s ease-in-out infinite}
@keyframes pulse{50%{opacity:.38;box-shadow:0 0 3px rgba(255,255,255,.2)}}
.hero h1{max-width:760px;margin:0;color:#fff;font-size:clamp(54px,7.4vw,104px);line-height:.86;
  letter-spacing:-.068em;font-weight:760;text-wrap:balance}
.hero h1 span{display:block;color:#777;font-weight:570}
.lead{max-width:650px;margin:32px 0;color:#b6b6b6;font-size:18px;line-height:1.72}
.lead strong{color:#fff}
.hero-actions{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-top:35px}
.button{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:48px;padding:0 18px;
  border:1px solid #fff;border-radius:11px;background:#fff;color:#080808;font-size:13px;font-weight:760;
  transition:transform .2s,box-shadow .2s,background .2s}
.button:hover{transform:translateY(-2px);box-shadow:0 12px 34px rgba(255,255,255,.13);background:#e7e7e7}
.button svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.text-link{padding:12px 8px;color:#aaa;font-size:13px;font-weight:650}.text-link:hover{color:#fff}

.creator-card{position:relative;isolation:isolate;min-height:540px;border:1px solid var(--line);border-radius:28px;
  background:linear-gradient(155deg,#181818,#090909 72%);box-shadow:0 40px 100px rgba(0,0,0,.42),inset 0 1px rgba(255,255,255,.06);
  overflow:visible;animation:card-in .8s cubic-bezier(.2,.8,.2,1) both}
@keyframes card-in{from{opacity:0;transform:translateY(24px) rotate(1.5deg)}to{opacity:1;transform:none}}
.creator-card::before{content:"";position:absolute;z-index:-1;width:390px;height:390px;right:-160px;top:-150px;
  border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.15),transparent 67%)}
.mock-top{height:58px;display:flex;align-items:center;gap:9px;padding:0 18px;border-bottom:1px solid var(--line)}
.avatar{display:grid;place-items:center;width:30px;height:30px;border:1px solid var(--line-strong);border-radius:50%;
  color:#fff;font-size:10px;font-weight:800}.handle{font-size:11px;color:#aaa}.handle strong{display:block;color:#eee;font-size:12px}
.status{margin-left:auto;padding:5px 8px;border:1px solid var(--line);border-radius:7px;color:#aaa;font-size:9px;text-transform:uppercase;letter-spacing:.1em}
.mock-stage{position:relative;height:285px;margin:15px;border:1px solid var(--line);border-radius:18px;overflow:hidden;
  background:radial-gradient(circle at 62% 25%,rgba(255,255,255,.17),transparent 31%),
    linear-gradient(145deg,#252525,#080808 72%)}
.creator-photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 19%;filter:grayscale(1) contrast(1.06);
  transform:scale(1.035);transition:transform .8s cubic-bezier(.2,.8,.2,1),filter .5s}
.creator-card:hover .creator-photo{transform:scale(1.085);filter:grayscale(1) contrast(1.12)}
.mock-stage::before{content:"";position:absolute;z-index:1;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.48),transparent 38%,transparent 68%,rgba(0,0,0,.27)),linear-gradient(0deg,rgba(0,0,0,.5),transparent 48%);pointer-events:none}
.mock-stage::after{content:"";position:absolute;z-index:2;width:42%;height:170%;left:-55%;top:-35%;transform:rotate(18deg);
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.15),transparent);filter:blur(7px);animation:photo-sweep 6.5s ease-in-out infinite}
@keyframes photo-sweep{45%,100%{left:130%}}
.product-tag{position:absolute;display:flex;align-items:center;gap:7px;padding:8px 10px;border:1px solid rgba(255,255,255,.17);
  z-index:3;border-radius:9px;background:rgba(5,5,5,.72);backdrop-filter:blur(10px);color:#ddd;font-size:10px;animation:float-tag 4s ease-in-out infinite alternate}
.product-tag::before{content:"";width:5px;height:5px;border-radius:50%;background:#fff;box-shadow:0 0 8px #fff}
.tag-a{left:17px;top:22px}.tag-b{right:17px;bottom:27px;animation-delay:-2s}@keyframes float-tag{to{transform:translateY(-7px)}}
.play{position:absolute;z-index:3;display:grid;place-items:center;
  width:44px;height:44px;left:50%;top:50%;transform:translate(-50%,-50%);border:1px solid rgba(255,255,255,.3);
  border-radius:50%;background:rgba(0,0,0,.4);color:#fff;font-size:14px;padding-left:2px;backdrop-filter:blur(8px);animation:play-ring 2.8s ease-out infinite}
@keyframes play-ring{55%{box-shadow:0 0 0 12px rgba(255,255,255,0)}70%,100%{box-shadow:0 0 0 0 rgba(255,255,255,0)}}
.floating-metric{position:absolute;z-index:4;right:-22px;top:105px;display:flex;align-items:center;gap:9px;padding:11px 13px;border:1px solid var(--line-strong);border-radius:12px;background:rgba(8,8,8,.78);backdrop-filter:blur(14px);box-shadow:0 18px 45px rgba(0,0,0,.35);animation:metric-float 5s ease-in-out infinite alternate}
.floating-metric svg{width:16px;height:16px;fill:none;stroke:#fff;stroke-width:1.7}.floating-metric span{color:#777;font-size:8px;text-transform:uppercase;letter-spacing:.12em}.floating-metric strong{display:block;color:#fff;font-size:13px;line-height:1.1}
@keyframes metric-float{to{transform:translateY(10px) rotate(1deg)}}
.mock-caption{padding:0 20px}.mock-caption p{margin:0 0 8px;color:#eee;font-size:13px;font-weight:650}
.mock-caption span{color:#777;font-size:11px}.mock-stats{display:flex;gap:18px;margin:18px 20px 0;padding-top:16px;border-top:1px solid var(--line)}
.mock-stats div{color:#777;font-size:9px;text-transform:uppercase;letter-spacing:.09em}.mock-stats strong{display:block;color:#fff;font-size:16px;letter-spacing:-.02em}

.platforms{border-top:1px solid var(--line);border-bottom:1px solid var(--line);overflow:hidden}
.platforms-in{min-height:78px;display:flex;align-items:center;justify-content:space-between;gap:24px}
.platforms-label{color:#686868;font-size:10px;font-weight:750;letter-spacing:.13em;text-transform:uppercase;white-space:nowrap}
.platform-list{display:flex;align-items:center;justify-content:flex-end;gap:clamp(22px,5vw,60px);flex-wrap:wrap}
.platform-list span{color:#bcbcbc;font-size:13px;font-weight:720;letter-spacing:.02em}

.catalog{padding-top:38px;padding-bottom:38px}.catalog-track{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}
.catalog-item{position:relative;min-height:112px;padding:20px;border:1px solid var(--line);border-radius:15px;background:rgba(255,255,255,.018);overflow:hidden;transition:.25s}
.catalog-item::after{content:"";position:absolute;width:100px;height:100px;right:-42px;bottom:-55px;border:1px solid rgba(255,255,255,.08);border-radius:50%;transition:.35s}
.catalog-item:hover{transform:translateY(-3px);background:rgba(255,255,255,.04);border-color:var(--line-strong)}.catalog-item:hover::after{transform:scale(1.35)}
.catalog-item span{color:#606060;font:600 9px Consolas,"Courier New",monospace;letter-spacing:.1em}.catalog-item strong{display:block;margin-top:26px;color:#eaeaea;font-size:13px;letter-spacing:.01em}

.section{padding-top:120px;padding-bottom:120px;border-bottom:1px solid var(--line)}
.section-head{display:grid;grid-template-columns:180px 1fr;gap:44px;margin-bottom:58px}
.section-index{color:#666;font:600 10px/1.5 Consolas,"Courier New",monospace;letter-spacing:.12em;text-transform:uppercase}
.section-title{max-width:830px;margin:0;color:#fff;font-size:clamp(38px,5vw,68px);line-height:1.02;letter-spacing:-.05em;text-wrap:balance}
.section-copy{max-width:680px;margin:22px 0 0;color:#9e9e9e;font-size:16px}

.about-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:16px}
.feature{min-height:310px;padding:36px;border:1px solid var(--line);border-radius:20px;background:linear-gradient(145deg,#151515,#0c0c0c);
  position:relative;overflow:hidden;transition:transform .25s,border-color .25s}
.feature:hover{transform:translateY(-3px);border-color:var(--line-strong)}
.feature svg{width:28px;height:28px;fill:none;stroke:#fff;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
.feature h3{max-width:350px;margin:62px 0 13px;color:#fff;font-size:24px;line-height:1.15;letter-spacing:-.03em}
.feature p{max-width:480px;margin:0;color:#959595;font-size:14px}
.feature-large::after{content:"CREATOR";position:absolute;right:-18px;bottom:-35px;color:rgba(255,255,255,.025);
  font-size:112px;font-weight:900;letter-spacing:-.08em}

.benefits{display:grid;grid-template-columns:1.15fr .85fr;gap:16px}
.benefit-main{grid-row:span 2;min-height:520px;padding:46px;border:1px solid #fff;border-radius:24px;background:#f2f2f2;color:#080808;
  display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;position:relative}
.benefit-main::after{content:"%";position:absolute;right:-18px;bottom:-100px;color:rgba(0,0,0,.055);font-size:360px;font-weight:900;line-height:1}
.benefit-kicker{font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}
.benefit-number{font-size:clamp(120px,15vw,210px);line-height:.75;letter-spacing:-.09em;font-weight:820}
.benefit-main p{max-width:370px;margin:28px 0 0;color:#353535;font-size:17px;line-height:1.55}
.benefit-small{min-height:252px;padding:34px;border:1px solid var(--line);border-radius:24px;background:#111;display:flex;
  flex-direction:column;justify-content:space-between;transition:border-color .2s,transform .2s}
.benefit-small:hover{border-color:var(--line-strong);transform:translateY(-2px)}
.benefit-small strong{color:#fff;font-size:70px;line-height:1;letter-spacing:-.065em}.benefit-small span{display:block;color:#aaa;font-size:14px;max-width:280px}

.requirements{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.requirement{display:grid;grid-template-columns:52px 1fr;gap:18px;align-items:start;padding:26px;border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,.022)}
.check{display:grid;place-items:center;width:46px;height:46px;border:1px solid var(--line-strong);border-radius:14px;background:rgba(255,255,255,.05)}
.check svg{width:22px;height:22px;fill:none;stroke:#fff;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.requirement h3{margin:2px 0 7px;color:#fff;font-size:15px}.requirement p{margin:0;color:#888;font-size:13px}

.steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.step{position:relative;min-height:285px;padding:30px 25px;border-right:1px solid var(--line)}.step:last-child{border:0}
.step-no{color:#666;font:600 11px Consolas,"Courier New",monospace}.step h3{margin:96px 0 11px;color:#fff;font-size:18px;letter-spacing:-.02em}
.step p{margin:0;color:#858585;font-size:13px}.step::after{content:"";position:absolute;left:25px;top:72px;width:5px;height:5px;border-radius:50%;background:#fff;box-shadow:0 0 12px #fff}

.cta{padding-top:130px;padding-bottom:130px}.cta-card{position:relative;overflow:hidden;padding:58px;border:1px solid var(--line-strong);border-radius:28px;
  background:linear-gradient(135deg,#191919,#090909 72%);box-shadow:0 38px 100px rgba(0,0,0,.38)}
.cta-card::before{content:"";position:absolute;width:650px;height:650px;left:50%;top:-520px;transform:translateX(-50%);border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.17),transparent 67%)}
.application-grid{position:relative;display:grid;grid-template-columns:.78fr 1.22fr;gap:64px;align-items:start}
.cta-icon{position:relative;display:grid;place-items:center;width:54px;height:54px;margin:0 0 28px;border:1px solid var(--line-strong);border-radius:16px;background:rgba(255,255,255,.055)}
.cta-icon svg{width:25px;height:25px;fill:none;stroke:#fff;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
.cta h2{position:relative;margin:0;color:#fff;font-size:clamp(38px,4.4vw,60px);line-height:.98;letter-spacing:-.052em;text-wrap:balance}
.cta-copy>p{position:relative;margin:24px 0 20px;color:#a5a5a5;font-size:15px}
.privacy-note{display:block;color:#666;font-size:10px;line-height:1.55}
.application-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:17px;padding:28px;border:1px solid var(--line);border-radius:20px;background:rgba(0,0,0,.28)}
.form-field{display:grid;gap:8px}.form-field.full{grid-column:1/-1}.form-field label,.group-label{color:#d7d7d7;font-size:11px;font-weight:700}
.form-field input,.form-field select,.form-field textarea{width:100%;border:1px solid rgba(255,255,255,.13);border-radius:10px;background:#0b0b0b;color:#fff;
  font-family:inherit;font-size:13px;font-weight:500;line-height:1.4;padding:12px 13px;outline:none;transition:border-color .2s,box-shadow .2s}
.form-field textarea{min-height:112px;resize:vertical}.form-field input::placeholder,.form-field textarea::placeholder{color:#555}
.form-field input:focus,.form-field select:focus,.form-field textarea:focus{border-color:rgba(255,255,255,.55);box-shadow:0 0 0 3px rgba(255,255,255,.06)}
.form-help{color:#656565;font-size:9px;line-height:1.45}.platform-options{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}
.platform-option{position:relative}.platform-option input{position:absolute;opacity:0;pointer-events:none}.platform-option span{display:grid;place-items:center;min-height:38px;
  border:1px solid var(--line);border-radius:9px;color:#858585;font-size:10px;font-weight:650;cursor:pointer;transition:.2s}
.platform-option input:checked+span{border-color:#fff;background:#fff;color:#080808}.platform-option input:focus-visible+span{outline:2px solid #fff;outline-offset:2px}
.consent{grid-column:1/-1;display:flex;gap:10px;align-items:flex-start;color:#898989;font-size:10px;line-height:1.5;cursor:pointer}
.consent input{flex:0 0 auto;margin-top:2px;accent-color:#fff}.application-form .button{grid-column:1/-1;width:100%;border:0;cursor:pointer}
.honeypot{position:absolute!important;left:-10000px!important;width:1px!important;height:1px!important;overflow:hidden!important}
.button-muted{position:relative;display:inline-flex;align-items:center;min-height:48px;padding:0 18px;border:1px solid var(--line-strong);
  border-radius:11px;background:rgba(255,255,255,.055);color:#d0d0d0;font-size:12px;font-weight:700}
.cta .button{position:relative}
.note{display:block;margin-top:13px;color:#626262;font-size:10px;text-align:center}

.result{min-height:calc(100vh - 151px);display:grid;place-items:center;padding-top:70px;padding-bottom:70px}.result-card{max-width:680px;width:100%;padding:56px;
  border:1px solid var(--line-strong);border-radius:26px;background:linear-gradient(145deg,#171717,#090909);text-align:center}
.result-mark{display:grid;place-items:center;width:58px;height:58px;margin:0 auto 26px;border:1px solid var(--line-strong);border-radius:50%;font-size:24px}
.result h1{margin:0;color:#fff;font-size:clamp(36px,5vw,58px);line-height:1;letter-spacing:-.05em}.result p{max-width:520px;margin:22px auto 30px;color:#aaa}

.foot{border-top:1px solid var(--line)}.foot-in{min-height:82px;display:flex;align-items:center;gap:14px;color:#6e6e6e;font-size:11px}
.foot strong{color:#bdbdbd}.foot-nav{margin-left:auto;display:flex;gap:18px}.foot-nav a:hover{color:#fff}

@supports(animation-timeline:view()){
  .feature,.benefit-small,.requirement,.step{animation:reveal linear both;animation-timeline:view();animation-range:entry 0% entry 28%}
  @keyframes reveal{from{opacity:.15;transform:translateY(22px)}to{opacity:1;transform:translateY(0)}}
}
@media(max-width:920px){
  .hero{grid-template-columns:1fr;gap:55px;padding-top:80px}.creator-card{min-height:500px;max-width:590px;width:100%;margin:auto}
  .floating-metric{right:12px}
  .catalog-track{grid-template-columns:repeat(3,1fr)}
  .section-head{grid-template-columns:1fr;gap:12px}.about-grid,.benefits{grid-template-columns:1fr}.benefit-main{grid-row:auto;min-height:430px}
  .steps{grid-template-columns:repeat(2,1fr)}.step:nth-child(2){border-right:0}.step:nth-child(-n+2){border-bottom:1px solid var(--line)}
}
@media(max-width:650px){
  .top-in{padding:0 16px}.nav a:not(.active){display:none}.container{padding-left:15px;padding-right:15px}
  .hero{min-height:auto;padding-top:70px;padding-bottom:56px}.hero h1{font-size:57px}.lead{font-size:16px}.creator-card{min-height:475px;border-radius:20px}
  .platforms-in{padding-top:20px;padding-bottom:20px;align-items:flex-start;flex-direction:column}.platform-list{justify-content:flex-start;gap:18px 26px}
  .catalog{padding-top:24px;padding-bottom:24px}.catalog-track{grid-template-columns:1fr}.catalog-item{min-height:96px;padding:16px}.catalog-item strong{margin-top:20px;font-size:12px}.floating-metric{top:94px;right:4px;transform:scale(.88);transform-origin:right center}
  .section{padding-top:84px;padding-bottom:84px}.section-title{font-size:40px}.section-head{margin-bottom:38px}
  .about-grid,.requirements{grid-template-columns:1fr}.feature{min-height:270px;padding:27px}.feature h3{margin-top:52px}
  .benefit-main{min-height:390px;padding:30px}.benefit-number{font-size:130px}.benefit-small{min-height:215px;padding:28px}
  .steps{grid-template-columns:1fr}.step{min-height:220px;border-right:0;border-bottom:1px solid var(--line)!important}.step:last-child{border-bottom:0!important}.step h3{margin-top:60px}
  .cta{padding-top:85px;padding-bottom:85px}.cta-card{padding:32px 19px;border-radius:21px}.cta h2{font-size:43px}
  .application-grid{grid-template-columns:1fr;gap:36px}.application-form{grid-template-columns:1fr;padding:20px}.form-field.full,.consent,.application-form .button{grid-column:1}
  .platform-options{grid-template-columns:repeat(2,1fr)}.result-card{padding:42px 22px}
  .foot-in{padding:22px 15px;flex-wrap:wrap}.foot-nav{width:100%;margin-left:0}
}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.ambient::after,.orb,.beam,.live-dot,.creator-card,.mock-stage::after,.product-tag,.play,.floating-metric{animation:none}.creator-photo{transition:none}.feature,.benefit-small,.requirement,.step{animation:none!important}}
`;

function renderPage() {
  return (
    `<!doctype html><html lang="pt-BR"><head>` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="theme-color" content="#050505">` +
    `<meta name="description" content="Programa oficial de influenciadores e streamers da Vook Store.">` +
    `<meta property="og:title" content="Creators Vook — Programa de Influenciadores">` +
    `<meta property="og:description" content="Transforme seu conteúdo de RP em uma parceria com a Vook Store.">` +
    `<meta property="og:type" content="website">` +
    `<title>Creators Vook — Programa de Influenciadores</title><style>${CSS}</style></head><body>` +
    `<a class="skip" href="#conteudo">Ir para o conteúdo</a><div class="ambient" aria-hidden="true"><i class="orb orb-a"></i><i class="orb orb-b"></i><i class="beam"></i></div>` +
    `<header class="top"><div class="top-in"><a class="brand" href="/">${STORE_NAME}</a>` +
    `<nav class="nav" aria-label="Navegação principal"><a href="/termos">Termos</a><a href="/privacidade">Privacidade</a>` +
    `<a class="active" href="/${INFLUENCER_SLUG}" aria-current="page">Creators</a></nav></div></header>` +
    `<main id="conteudo">` +
    `<section class="hero container"><div class="hero-copy"><p class="kicker"><span class="live-dot"></span>Programa de creators</p>` +
    `<h1>Sua criatividade.<span>Nossa vitrine.</span></h1>` +
    `<p class="lead">A <strong>Vook Store</strong> está procurando influenciadores e streamers que vivem o universo do RP e sabem transformar boas histórias em conteúdo que prende a atenção.</p>` +
    `<div class="hero-actions"><a class="button" href="#inscricao">Quero ser creator ${ICONS.arrow}</a>` +
    `<a class="text-link" href="#beneficios">Conhecer benefícios</a></div></div>` +
    `<div class="creator-card" aria-label="Exemplo visual de conteúdo de creator"><div class="mock-top"><span class="avatar">VS</span>` +
    `<span class="handle"><strong>Creator Vook</strong>@seuperfil</span><span class="status">Conteúdo em destaque</span></div>` +
    `<div class="mock-stage"><img class="creator-photo" src="/creator-editorial.png" width="1122" height="1402" decoding="async" fetchpriority="high" alt="Creator de RP com visual de fantasia em preto e branco"><span class="product-tag tag-a">Look exclusivo</span>` +
    `<span class="product-tag tag-b">Vook Store</span><span class="play" aria-hidden="true">▶</span></div>` +
    `<span class="floating-metric">${ICONS.eye}<span>alcance<strong>+48 mil</strong></span></span>` +
    `<div class="mock-caption"><p>Seu RP, sua estética, sua forma de contar.</p><span>Conteúdo ilustrativo do programa de creators.</span></div>` +
    `<div class="mock-stats"><div><strong>30%</strong>benefício creator</div><div><strong>15%</strong>para seguidores</div></div></div></section>` +

    `<section class="platforms"><div class="platforms-in container"><span class="platforms-label">Crie onde sua audiência está</span>` +
    `<div class="platform-list"><span>TikTok</span><span>Instagram</span><span>YouTube</span><span>Twitch</span></div></div></section>` +

    `<section class="catalog container" aria-label="Categorias da Vook Store"><div class="catalog-track">` +
    `<article class="catalog-item"><span>01 / VISUAL</span><strong>Perucas</strong></article>` +
    `<article class="catalog-item"><span>02 / PERSONAGEM</span><strong>Peds</strong></article>` +
    `<article class="catalog-item"><span>03 / COLEÇÃO</span><strong>Pelúcias</strong></article></div></section>` +

    `<section class="section container" id="programa"><div class="section-head"><span class="section-index">01 — O programa</span><div>` +
    `<h2 class="section-title">Você cria as histórias. A Vook veste o seu universo.</h2>` +
    `<p class="section-copy">Divulgue perucas, peds, pelúcias, armas personalizadas e varinhas mágicas em vídeos, publicações ou transmissões ao vivo — sempre com a sua linguagem e autenticidade.</p></div></div>` +
    `<div class="about-grid"><article class="feature feature-large">${ICONS.video}<h3>Conteúdo que apresenta, inspira e envolve</h3>` +
    `<p>Crie vídeos e conteúdos mostrando nossos produtos dentro do seu RP, em cenas, composições, reviews ou formatos autorais.</p></article>` +
    `<article class="feature">${ICONS.users}<h3>Conexão real com a comunidade</h3>` +
    `<p>Apresente a Vook nas redes sociais e durante suas lives de forma natural, criativa e coerente com a sua audiência.</p></article>` +
    `<article class="feature">${ICONS.spark}<h3>Criatividade com espaço para crescer</h3>` +
    `<p>Use sua visão para desenvolver divulgações envolventes, consistentes e capazes de ampliar o alcance da marca.</p></article></div></section>` +

    `<section class="section container" id="beneficios"><div class="section-head"><span class="section-index">02 — Benefícios</span><div>` +
    `<h2 class="section-title">Uma parceria que reconhece o seu alcance.</h2>` +
    `<p class="section-copy">Benefícios exclusivos para você produzir mais e oferecer uma vantagem real a quem acompanha o seu conteúdo.</p></div></div>` +
    `<div class="benefits"><article class="benefit-main"><span class="benefit-kicker">Em todas as suas compras</span><div>` +
    `<strong class="benefit-number">30%</strong><p>de desconto para creators aprovados no programa oficial da Vook Store.</p></div></article>` +
    `<article class="benefit-small"><strong>02</strong><span>pedidos grátis por mês, à sua escolha.</span></article>` +
    `<article class="benefit-small"><strong>15%</strong><span>de desconto para seguidores com seu cupom personalizado.</span></article></div></section>` +

    `<section class="section container" id="requisitos"><div class="section-head"><span class="section-index">03 — Requisitos</span><div>` +
    `<h2 class="section-title">O que buscamos em um creator Vook.</h2>` +
    `<p class="section-copy">Não existe um único estilo ideal. Procuramos presença, consistência e responsabilidade para representar a marca.</p></div></div>` +
    `<div class="requirements">` +
    `<article class="requirement"><span class="check">${ICONS.check}</span><div><h3>Influência no universo do RP</h3><p>Boa visibilidade, participação ativa e conexão genuína com a comunidade.</p></div></article>` +
    `<article class="requirement"><span class="check">${ICONS.check}</span><div><h3>Presença digital ativa</h3><p>Produção recorrente em redes sociais ou plataformas de live streaming.</p></div></article>` +
    `<article class="requirement"><span class="check">${ICONS.check}</span><div><h3>18 anos ou mais</h3><p>É necessário ter atingido a maioridade para participar do programa.</p></div></article>` +
    `<article class="requirement"><span class="check">${ICONS.check}</span><div><h3>Maturidade e profissionalismo</h3><p>Comunicação respeitosa, compromisso e responsabilidade com a parceria.</p></div></article>` +
    `</div></section>` +

    `<section class="section container" id="inscricao"><div class="section-head"><span class="section-index">04 — Inscrição</span><div>` +
    `<h2 class="section-title">Do seu perfil para o nosso time.</h2>` +
    `<p class="section-copy">O processo acontece pelo Discord oficial da Vook Store e foi pensado para ser direto.</p></div></div>` +
    `<div class="steps"><article class="step"><span class="step-no">01</span><h3>Revise o programa</h3><p>Confira os benefícios, requisitos e responsabilidades da parceria.</p></article>` +
    `<article class="step"><span class="step-no">02</span><h3>Acesse o Discord</h3><p>Entre no servidor oficial e procure o canal destinado às inscrições.</p></article>` +
    `<article class="step"><span class="step-no">03</span><h3>Responda ao bot</h3><p>Envie as informações pessoais e os dados solicitados sobre seus perfis.</p></article>` +
    `<article class="step"><span class="step-no">04</span><h3>Aguarde a análise</h3><p>A equipe avaliará seu perfil e entrará em contato pelo canal oficial.</p></article></div></section>` +

    `<section class="cta container"><div class="cta-card"><div class="application-grid"><div class="cta-copy">` +
    `<span class="cta-icon">${ICONS.bag}</span><h2>Pronto para criar com a Vook?</h2>` +
    `<p>Preencha sua inscrição com atenção. Ela será enviada diretamente para o canal de aprovação da equipe Vook Store.</p>` +
    `<small class="privacy-note">Seu ID do Discord será usado apenas para identificar seu perfil e enviar o resultado da análise por mensagem direta.</small></div>` +
    `<form class="application-form" action="/api/influenciadores" method="post" accept-charset="UTF-8">` +
    `<div class="form-field"><label for="discord-id">ID do Discord</label><input id="discord-id" name="discordId" inputmode="numeric" pattern="[0-9]{17,20}" minlength="17" maxlength="20" placeholder="123456789012345678" required>` +
    `<small class="form-help">Ative o modo desenvolvedor no Discord e copie seu ID de usuário.</small></div>` +
    `<div class="form-field"><label for="discord-user">Usuário do Discord</label><input id="discord-user" name="discordUsername" minlength="2" maxlength="40" placeholder="seuusuario" autocomplete="username" required>` +
    `<small class="form-help">Informe exatamente como aparece no seu perfil.</small></div>` +
    `<div class="form-field"><label for="creator-name">Nome de creator</label><input id="creator-name" name="creatorName" minlength="2" maxlength="60" placeholder="Como sua audiência conhece você" required></div>` +
    `<div class="form-field"><label for="age">Idade</label><input id="age" name="age" type="number" min="18" max="99" placeholder="18" required></div>` +
    `<fieldset class="form-field full" style="border:0;margin:0;padding:0"><legend class="group-label">Plataformas em que produz (selecione pelo menos 2)</legend><div class="platform-options">` +
    `<label class="platform-option"><input type="checkbox" name="platforms" value="TikTok"><span>TikTok</span></label>` +
    `<label class="platform-option"><input type="checkbox" name="platforms" value="Instagram"><span>Instagram</span></label>` +
    `<label class="platform-option"><input type="checkbox" name="platforms" value="YouTube"><span>YouTube</span></label>` +
    `<label class="platform-option"><input type="checkbox" name="platforms" value="Twitch"><span>Twitch</span></label></div></fieldset>` +
    `<div class="form-field full"><label for="profiles">Links dos seus perfis</label><textarea id="profiles" name="profileLinks" maxlength="900" placeholder="Cole um link por linha — com ou sem https://" required></textarea></div>` +
    `<div class="form-field"><label for="audience">Tamanho da audiência</label><input id="audience" name="audience" maxlength="80" placeholder="Ex.: 12 mil no TikTok"></div>` +
    `<div class="form-field"><label for="rp-time">Experiência com RP</label><input id="rp-time" name="rpExperience" minlength="2" maxlength="100" placeholder="Ex.: 2 anos criando RP" required></div>` +
    `<div class="form-field full"><label for="motivation">Por que quer representar a Vook?</label><textarea id="motivation" name="motivation" minlength="2" maxlength="1200" placeholder="Conte sobre seu conteúdo, sua comunidade e suas ideias para a parceria" required></textarea></div>` +
    `<label class="honeypot" aria-hidden="true">Não preencha<input name="website" tabindex="-1" autocomplete="off"></label>` +
    `<label class="consent"><input type="checkbox" name="consent" value="yes" required><span>Confirmo que tenho 18 anos ou mais, que as informações são verdadeiras e que autorizo o contato da Vook Store pelo Discord sobre esta inscrição.</span></label>` +
    `<button class="button" type="submit">Enviar inscrição ${ICONS.arrow}</button>` +
    `<small class="note">A participação está sujeita à análise e aprovação da equipe Vook Store.</small></form></div></div></section>` +
    `</main>` +
    `<footer class="foot"><div class="foot-in container"><strong>${STORE_NAME}</strong><span>Programa oficial de creators</span>` +
    `<nav class="foot-nav" aria-label="Documentos"><a href="/termos">Termos</a><a href="/privacidade">Privacidade</a></nav></div></footer>` +
    `</body></html>`
  );
}

const PAGE = renderPage();

export function renderInfluencerPage(slug) {
  if (slug !== INFLUENCER_SLUG) return null;
  return PAGE;
}

export function renderInfluencerResult(ok, title, message) {
  const mark = ok ? '✓' : '!';
  return (
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#050505">` +
    `<title>${title} — ${STORE_NAME}</title><style>${CSS}</style></head><body>` +
    `<div class="ambient" aria-hidden="true"></div><header class="top"><div class="top-in">` +
    `<a class="brand" href="/">${STORE_NAME}</a><nav class="nav" aria-label="Navegação principal">` +
    `<a href="/termos">Termos</a><a href="/privacidade">Privacidade</a><a class="active" href="/${INFLUENCER_SLUG}">Creators</a>` +
    `</nav></div></header><main class="result container"><section class="result-card">` +
    `<span class="result-mark" aria-hidden="true">${mark}</span><h1>${title}</h1><p>${message}</p>` +
    `<a class="button" href="/${INFLUENCER_SLUG}">Voltar ao programa ${ICONS.arrow}</a>` +
    `</section></main><footer class="foot"><div class="foot-in container"><strong>${STORE_NAME}</strong>` +
    `<span>Programa oficial de creators</span></div></footer></body></html>`
  );
}
