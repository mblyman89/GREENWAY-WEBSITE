/**
 * R58-S1 — our own tiny WebGL2 smoke renderer (no three.js; works on phones).
 *
 * One canvas per banner draws every non-WebGPU smoke layer in one pass each
 * (premultiplied-alpha blending). Techniques:
 *  - fbm value noise + domain warping (Inigo Quilez, "warp") for fog/haze/plume
 *  - Brad Woods "Shaders 103 — smoke": noise scrolling upward, smoothstep
 *    remap to thin it out, edge fades, and a twist that grows with height —
 *    done here in 2D: the column sways more the higher it rises.
 *  - drawn at ½–¾ resolution and stretched by CSS (smoke is soft, so nobody
 *    can tell) and DPR capped at 1.5 → cheap enough for phones.
 */
import { glParams, onceSeconds, type SmokeLayer } from "@/lib/cms/banner-atmos-core";

const VS = `#version 300 es
in vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;

const FS = `#version 300 es
precision highp float;
uniform vec2 uRes;uniform float uTime;uniform int uMode;uniform vec2 uOrigin;uniform float uDir;
uniform vec3 uC1;uniform vec3 uC2;uniform float uAmount;uniform float uSize;uniform float uRainbow;
uniform float uLife;uniform float uFade;uniform float uAspect;
out vec4 o;
float h(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);for(int i=0;i<5;i++){v+=a*n(p);p=m*p;a*=.5;}return v;}
vec3 pal(float t){return .5+.5*cos(6.2831*(t+vec3(0.,.33,.67)));}
void main(){
 vec2 uv=gl_FragCoord.xy/uRes;vec2 q=vec2(uv.x*uAspect,uv.y);float t=uTime;float d=0.;float age=0.;
 if(uMode==0){
  float H=.15+.55*uSize;vec2 p=q*vec2(2.2,3.5);
  vec2 w=vec2(fbm(p+vec2(t*.05,0.)),fbm(p+vec2(5.2,1.3)-vec2(0.,t*.07)));
  float f=fbm(p+1.8*w+vec2(t*.04,-t*.06));
  float mask=smoothstep(H,0.,uv.y+(f-.5)*.35*H);
  d=smoothstep(.25,.85,f)*mask*1.25;age=uv.y/H;
 }else if(uMode==1){
  vec2 dv=vec2(sin(uDir),cos(uDir));vec2 p=q*(1.2+1.8*(1.-uSize))-dv*t*.03;
  vec2 w=vec2(fbm(p+t*.02),fbm(p+vec2(3.1,7.4)));float f=fbm(p+1.5*w);
  d=smoothstep(.3,.9,f)*.8;age=f;
 }else{
  vec2 r=q-vec2(uOrigin.x*uAspect,uOrigin.y);float c=cos(uDir),s=sin(uDir);
  vec2 p=vec2(r.x*c-r.y*s,r.x*s+r.y*c);float yy=max(p.y,0.);
  if(uMode==2){
   float L=.25+.75*uSize;
   float sway=(fbm(vec2(yy*2.5-t*.35,t*.07))-.5)*yy*1.4+sin(yy*9.-t*1.3)*.08*yy;
   float wdt=.007+yy*yy*.55+yy*.05;float x=(p.x-sway)/wdt;
   float core=exp(-x*x)*mix(1.,.45,smoothstep(0.,L,yy));
   float x2=(p.x-sway*1.3-.02*yy)/(wdt*.55);float fil=exp(-x2*x2)*.5;
   float halo=exp(-x*x*.18)*.35*smoothstep(.04,.3,yy);
   float tex=smoothstep(.2,.8,fbm(vec2(p.x*7.,yy*4.-t*.8)+vec2(sway*3.,0.)));
   float up=smoothstep(L,L*.55,yy)*smoothstep(-.02,.03,p.y);
   d=(core+fil*smoothstep(.05,.2,yy)+halo*tex)*mix(1.,.5+tex,smoothstep(0.,.12,yy))*up;age=yy/L;
  }else{
   float R=(.25+.75*uSize)*max(uAspect,1.)*1.1;vec2 adv=vec2(p.x,p.y-t*.35);
   vec2 w=vec2(fbm(adv*3.),fbm(adv*3.+vec2(4.7,1.9)));float f=fbm(adv*2.4+1.6*w);
   float wdt=.04+yy*.38;float x=p.x/wdt;float cone=exp(-x*x*1.4);
   float front=uLife*R;float fm=smoothstep(front,front-.25,yy+(f-.5)*.3);
   d=smoothstep(.2,.8,f)*1.4*cone*fm*smoothstep(-.03,.05,p.y);age=yy/R;
  }
 }
 d=clamp(d*uAmount*uFade,0.,1.);
 vec3 col=mix(uC1,uC2,clamp(age,0.,1.));
 if(uRainbow>.5)col=pal(age*.8+t*.08+d*.3);
 col*=.85+.3*d;o=vec4(col*d,d);
}`;

type U = Record<string, WebGLUniformLocation | null>;
const NAMES = ["uRes", "uTime", "uMode", "uOrigin", "uDir", "uC1", "uC2", "uAmount", "uSize", "uRainbow", "uLife", "uFade", "uAspect"];

export class GlSmoke {
  private gl: WebGL2RenderingContext;
  private u: U = {};
  private layers: SmokeLayer[] = [];
  private raf = 0;
  private t0 = performance.now();
  private resetAt = new Map<string, number>();
  private still: boolean;
  ok = false;

  constructor(private canvas: HTMLCanvasElement, opts: { still?: boolean } = {}) {
    this.still = !!opts.still;
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, alpha: true, antialias: false, powerPreference: "low-power" });
    if (!gl) throw new Error("no webgl2");
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("link");
    gl.useProgram(p);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of NAMES) this.u[n] = gl.getUniformLocation(p, n);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.ok = true;
  }

  setLayers(layers: SmokeLayer[]) {
    const known = new Set(this.layers.map((l) => l.id));
    for (const l of layers) if (!known.has(l.id)) this.resetAt.set(l.id, performance.now());
    this.layers = layers;
    if (this.still) this.frame(performance.now());
  }

  /** Replay "once" layers from the start (slide shown again / Studio ▶). */
  replay() {
    const now = performance.now();
    for (const l of this.layers) this.resetAt.set(l.id, now);
  }

  start() {
    if (this.still) return this.frame(performance.now());
    const loop = (now: number) => {
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  destroy() {
    this.stop();
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.ok = false;
  }

  private frame(now: number) {
    const { gl, canvas, u } = this;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (!cw || !ch) return;
    const phone = cw < 768;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const scale = Math.max(...this.layers.map((l) => glParams(l, phone).scale), 0.5);
    const w = Math.max(1, Math.round(cw * dpr * scale));
    const h = Math.max(1, Math.round(ch * dpr * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(u.uRes, w, h);
    gl.uniform1f(u.uAspect, cw / ch);
    for (const l of this.layers) {
      const g = glParams(l, phone);
      const since = this.still ? 7 : (now - (this.resetAt.get(l.id) ?? this.t0)) / 1000 - (l.delay ?? 0);
      if (since < 0) continue;
      let life = 1;
      let fade = Math.min(1, since / 1.2);
      if (l.once || l.kind === "hit") {
        const D = onceSeconds(l);
        const cyc = l.once ? since : since % (D + 1.5);
        const pr = cyc / D;
        if (l.once && pr >= 1) continue;
        life = Math.min(1, pr / 0.45);
        life = 1 - (1 - life) * (1 - life);
        fade = Math.min(1, pr * 6) * (1 - smooth(0.6, 1, pr));
      }
      gl.uniform1f(u.uTime, (this.still ? 7 : (now - this.t0) / 1000) * g.speed);
      gl.uniform1i(u.uMode, g.mode);
      gl.uniform2f(u.uOrigin, g.ox, g.oy);
      gl.uniform1f(u.uDir, g.dir);
      gl.uniform3f(u.uC1, ...g.c1);
      gl.uniform3f(u.uC2, ...g.c2);
      gl.uniform1f(u.uAmount, g.amount);
      gl.uniform1f(u.uSize, g.size);
      gl.uniform1f(u.uRainbow, g.rainbow);
      gl.uniform1f(u.uLife, life);
      gl.uniform1f(u.uFade, fade);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }
}

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
