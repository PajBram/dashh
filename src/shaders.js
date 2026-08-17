// All GLSL på ett ställe. WebGL2 / GLSL ES 3.00.

const FOG = /* glsl */`
uniform vec3 uFogCol;
uniform vec2 uFog;            // x = startavstånd, y = slutavstånd
uniform float uFogHeight;     // hur snabbt diset tunnas ut uppåt
vec3 applyFog(vec3 col, float dist){
  return mix(col, uFogCol, smoothstep(uFog.x, uFog.y, dist));
}
/* Höjdberoende dis: tätt nere i dalarna och på gatunivå, tunnare högt upp.
   Det är den som ger djup åt landskapet.

   Tunningen räknas på MEDELHÖJDEN mellan ögat och punkten, inte på punktens
   egen höjd. Ljuset från en bergstopp har ju färdats hela vägen ner genom
   det låga diset för att nå en spelare som står på marken. Med bara punktens
   höjd slutade bergsranden döljas och lade sig som en mörk mur runt hela
   världen — det såg ut som att himlen blivit grå. */
vec3 applyFogH(vec3 col, float dist, float worldY){
  float f = smoothstep(uFog.x, uFog.y, dist);
  float avgY = max((worldY + uEye.y) * 0.5, 0.0);
  f *= exp(-avgY * uFogHeight);
  return mix(col, uFogCol, clamp(f, 0.0, 1.0));
}`;

const LIGHT = /* glsl */`
uniform vec3 uSunDir;         // enhetsvektor mot ljuset
uniform vec3 uSunCol;
uniform vec3 uAmb;
uniform vec3 uSkyTint;        // himlens färg ovanifrån
uniform vec3 uGroundTint;     // markens återkast underifrån
/* Halvsfärsljus: ytor som vetter uppåt får himlens färg, nedåtvända får
   markens återkast. Tinterna ligger kring 1,0 så helhetsljusstyrkan är
   densamma som förut — det här flyttar kulör, inte exponering. */
vec3 shade(vec3 n, vec3 albedo){
  float d = max(dot(n, uSunDir), 0.0);
  float wrap = dot(n, uSunDir) * 0.5 + 0.5;       // mjukt halvljus
  float sky = n.y * 0.5 + 0.5;                    // himmelsbidrag uppifrån
  vec3 ambient = uAmb * (0.55 + 0.45 * sky) * mix(uGroundTint, uSkyTint, sky);
  return albedo * (ambient + uSunCol * (d * 0.9 + wrap * 0.22));
}
/* Smal glansdager — får metall, neon och våta ytor att fånga ljuset. */
vec3 specular(vec3 n, vec3 view, float strength){
  vec3 hv = normalize(uSunDir + view);
  return uSunCol * pow(max(dot(n, hv), 0.0), 46.0) * strength;
}`;

// ------------------------------------------------------------------ terräng

export const TERRAIN_VS = /* glsl */`#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec3 aCol;
uniform mat4 uVP;
out vec3 vN; out vec3 vC; out vec3 vW;
void main(){
  vN = aNrm; vC = aCol; vW = aPos;
  gl_Position = uVP * vec4(aPos, 1.0);
}`;

export const TERRAIN_FS = /* glsl */`#version 300 es
precision highp float;
in vec3 vN; in vec3 vC; in vec3 vW;
uniform vec3 uEye;
uniform vec3 uPlayer;
uniform float uNight;
uniform float uCity;
${LIGHT}
${FOG}
out vec4 frag;
void main(){
  vec3 n = normalize(vN);
  vec3 col = shade(n, vC);
  if (uCity > 0.5) {
    // neonlinjer längs gatorna (kvartersgränserna) + svagt gatunät
    vec2 cellPos = fract((vW.xz + 150.0) / 26.0);
    vec2 lineDist = min(cellPos, 1.0 - cellPos) * 26.0;
    float line = smoothstep(0.55, 0.12, min(lineDist.x, lineDist.y));
    col += vec3(0.10, 0.65, 0.85) * line * 0.55;
    vec2 sub = fract(vW.xz / 3.25);
    vec2 sd = min(sub, 1.0 - sub) * 3.25;
    float subline = smoothstep(0.14, 0.04, min(sd.x, sd.y));
    col += vec3(0.30, 0.10, 0.45) * subline * 0.16;
  }
  // energilampa runt spelaren — bara i mörker, gör natten läsbar
  float lamp = 0.15 + uNight * 0.85;
  float d = length(vW.xz - uPlayer.xz);
  float ring = smoothstep(3.2, 2.2, abs(d - 2.6)) * 0.10;
  col += vec3(0.25, 0.85, 1.0) * ring * lamp;
  col += vec3(0.05, 0.22, 0.30) * max(0.0, 1.0 - d * 0.06) * 0.25 * uNight;
  frag = vec4(applyFogH(col, distance(vW, uEye), vW.y), 1.0);
}`;

// -------------------------------------------------------------- instansierat

const ROT = /* glsl */`
mat3 rotMat(vec3 r){
  float cx=cos(r.x), sx=sin(r.x), cy=cos(r.y), sy=sin(r.y), cz=cos(r.z), sz=sin(r.z);
  mat3 Rx = mat3(1.0,0.0,0.0,  0.0,cx,sx,  0.0,-sx,cx);
  mat3 Ry = mat3(cy,0.0,-sy,   0.0,1.0,0.0, sy,0.0,cy);
  mat3 Rz = mat3(cz,sz,0.0,   -sz,cz,0.0,  0.0,0.0,1.0);
  return Ry * Rx * Rz;
}`;

export const INST_VS = /* glsl */`#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec3 iPos;
layout(location=3) in vec3 iScale;
layout(location=4) in vec3 iCol;
layout(location=5) in vec3 iRot;
layout(location=6) in float iGlow;
layout(location=7) in float iSway;
uniform mat4 uVP;
uniform float uTime;
uniform vec2 uWind;           // riktning × styrka
${ROT}
out vec3 vN; out vec3 vC; out vec3 vW; out float vGlow;
void main(){
  mat3 R = rotMat(iRot);
  vec3 world = R * (aPos * iScale) + iPos;

  /* Vind: böjningen växer med höjden över objektets fot, så stammen står
     stilla medan kronan vaggar. Fasen kommer ur objektets världsläge, så
     varje träd och grässtrå rör sig i sin egen takt i stället för att hela
     skogen svaja som en enda kropp. Byar rullar genom landskapet via en
     långsam våg i samma led som vinden blåser. */
  if (iSway > 0.0) {
    // t: 0 vid objektets fot, 1 vid dess topp — foten står stilla
    float t = clamp((world.y - iPos.y) / max(iScale.y, 0.001) + 0.5, 0.0, 1.0);
    float phase = iPos.x * 0.35 + iPos.z * 0.27;
    float gust = 0.65 + 0.35 * sin(uTime * 0.5 + (iPos.x + iPos.z) * 0.04);
    float bend = sin(uTime * 1.7 + phase) * 0.5 + sin(uTime * 2.9 + phase * 1.7) * 0.22;
    // iSway är utslaget i meter vid full vind
    world.xz += uWind * (iSway * t * gust * (0.55 + bend));
  }

  vN = normalize(R * (aNrm / max(abs(iScale), vec3(0.0005))));
  vC = iCol; vW = world; vGlow = iGlow;
  gl_Position = uVP * vec4(world, 1.0);
}`;

export const INST_FS = /* glsl */`#version 300 es
precision highp float;
in vec3 vN; in vec3 vC; in vec3 vW; in float vGlow;
uniform vec3 uEye;
${LIGHT}
${FOG}
out vec4 frag;
void main(){
  vec3 n = normalize(vN);
  vec3 view = normalize(uEye - vW);
  vec3 col = shade(n, vC);
  float rim = pow(1.0 - max(dot(n, view), 0.0), 2.5);
  col += vC * rim * (0.35 + vGlow * 1.2);
  col += vC * vGlow * 1.35;
  // självlysande ytor behöver ingen dager — de lyser redan
  col += specular(n, view, 0.22 * (1.0 - min(vGlow, 1.0)));
  float dist = distance(vW, uEye);
  col = applyFogH(col, dist, vW.y);
  frag = vec4(col, 1.0);
}`;

// ------------------------------------------------------------------ skuggor

export const SHADOW_VS = /* glsl */`#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec3 iPos;
layout(location=3) in vec3 iScale;
layout(location=4) in vec3 iCol;
layout(location=5) in vec3 iRot;
layout(location=6) in float iGlow;
uniform mat4 uVP;
out float vAlpha; out vec2 vLocal;
void main(){
  // bara vridning kring Y — skuggan ligger platt på marken ändå
  float c = cos(iRot.y), s = sin(iRot.y);
  vec3 p = aPos * iScale;
  vec3 world = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z) + iPos;
  vAlpha = iGlow;
  vLocal = aPos.xz * 2.0;
  gl_Position = uVP * vec4(world, 1.0);
}`;

export const SHADOW_FS = /* glsl */`#version 300 es
precision mediump float;
in float vAlpha; in vec2 vLocal;
out vec4 frag;
void main(){
  float a = vAlpha * smoothstep(1.0, 0.25, length(vLocal));
  frag = vec4(0.0, 0.02, 0.06, a);
}`;

// ---------------------------------------------------------------- partiklar

export const PART_VS = /* glsl */`#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 iPos;
layout(location=2) in float iSize;
layout(location=3) in vec4 iCol;
uniform mat4 uVP;
uniform vec3 uRight;
uniform vec3 uUp;
out vec2 vUV; out vec4 vCol;
void main(){
  vUV = aCorner; vCol = iCol;
  vec3 w = iPos + uRight * (aCorner.x * iSize) + uUp * (aCorner.y * iSize);
  gl_Position = uVP * vec4(w, 1.0);
}`;

export const PART_FS = /* glsl */`#version 300 es
precision mediump float;
in vec2 vUV; in vec4 vCol;
out vec4 frag;
void main(){
  float d = length(vUV);
  if (d > 1.0) discard;
  float a = pow(1.0 - d, 1.6);
  frag = vec4(vCol.rgb, vCol.a * a);
}`;

// -------------------------------------------------------------------- himmel

export const SKY_VS = /* glsl */`#version 300 es
out vec2 vNdc;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vNdc = p * 2.0 - 1.0;
  gl_Position = vec4(vNdc, 1.0, 1.0);
}`;

export const SKY_FS = /* glsl */`#version 300 es
precision highp float;
in vec2 vNdc;
uniform mat4 uInvVP;
uniform vec3 uEye;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform float uNight;
uniform float uTime;
uniform float uClouds;   // 0 = klart, 1 = molnigt
out vec4 frag;

float hash13(vec3 p){
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float hash12(vec2 p){
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1,0)), u.x),
             mix(hash12(i + vec2(0,1)), hash12(i + vec2(1,1)), u.x), u.y);
}

/* Fyra oktaver räcker för moln som håller ihop både nära zenit och nere
   vid horisonten, där projektionen tänjs ut som mest. */
float fbm2(vec2 p){
  float sum = 0.0, amp = 0.5;
  for (int i = 0; i < 4; i++) { sum += vnoise(p) * amp; p = p * 2.03 + 11.7; amp *= 0.5; }
  return sum;
}

void main(){
  vec4 far = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize(far.xyz / far.w - uEye);

  float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(uSkyHorizon, uSkyTop, pow(h, 0.85));

  /* Moln: blickriktningen projiceras ner på ett plan högt över spelaren och
     bruset samplas där, så täcket ligger stilla i världen i stället för att
     följa med kameran. De driver sakta med tiden. */
  if (uClouds > 0.01 && dir.y > 0.10) {
    // Nämnaren MÅSTE klampas: nära horisonten går dir.xz/dir.y mot
    // oändligheten, bruset samplas i grus och himlen blir grå sörja i
    // stället för moln. Det såg ut som mulet väder över hela kartan.
    vec2 cp = dir.xz / max(dir.y, 0.22) * 0.30 + vec2(uTime * 0.0035, uTime * 0.0022);
    float c = fbm2(cp);
    // tunnare mot horisonten, där lagret ses nästan från sidan
    // Molnen håller sig till den övre himlen. Närmare horisonten tänjs
    // projektionen ut till stora suddiga fält som läser som mulet väder i
    // stället för som moln — där gör de mer skada än nytta.
    float band = smoothstep(0.12, 0.45, dir.y);
    // Tröskeln är högt satt med flit: bara brusets toppar blir moln, så
    // himlen förblir mest öppen och molnen läser som moln, inte som mulet.
    float cover = smoothstep(0.56, 0.85, c) * band * uClouds;
    // solsidan av molnen lyser upp, undersidan är grå
    float lit = smoothstep(0.0, 0.6, dot(normalize(vec3(dir.x, 0.35, dir.z)), uSunDir));
    vec3 cloudCol = mix(mix(uSkyHorizon * 1.3, vec3(1.0), 0.68), uSunCol * 0.85 + 0.3, lit * 0.5);
    col = mix(col, cloudCol, clamp(cover, 0.0, 0.82));
  }

  // stjärnor på natten
  if (uNight > 0.01) {
    vec3 g = floor(dir * 260.0);
    float s = hash13(g);
    float star = smoothstep(0.9975, 1.0, s) * smoothstep(-0.05, 0.35, dir.y);
    col += vec3(0.85, 0.92, 1.0) * star * uNight * 2.2;
  }

  // sol/måne med halo
  float sd = max(dot(dir, uSunDir), 0.0);
  col += uSunCol * pow(sd, 900.0) * 3.2;
  col += uSunCol * pow(sd, 22.0) * 0.30;
  col += uSunCol * pow(sd, 4.0) * 0.06;

  // horisontdis
  col = mix(col, uSkyHorizon, smoothstep(0.12, -0.02, dir.y));
  frag = vec4(col, 1.0);
}`;

// ------------------------------------------------------------------- vatten

export const WATER_VS = /* glsl */`#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uVP;
uniform float uTime;
uniform float uSize;
uniform float uLevel;
out vec3 vW; out vec3 vN;
void main(){
  vec3 p = vec3(aPos.x * uSize, uLevel, aPos.z * uSize);
  // tre långa dyningar plus två korta krusningar tvärs över dem
  float a = sin(p.x * 0.25 + uTime * 1.3) * 0.10;
  float b = sin(p.z * 0.31 - uTime * 1.1) * 0.09;
  float c = sin((p.x + p.z) * 0.13 + uTime * 0.7) * 0.07;
  float d = sin(p.x * 0.85 - p.z * 0.62 + uTime * 2.1) * 0.030;
  float e = sin(p.x * 1.31 + p.z * 1.05 - uTime * 2.7) * 0.022;
  p.y += a + b + c + d + e;
  float dx = cos(p.x * 0.25 + uTime * 1.3) * 0.025 + cos((p.x + p.z) * 0.13 + uTime * 0.7) * 0.009
           + cos(p.x * 0.85 - p.z * 0.62 + uTime * 2.1) * 0.026
           + cos(p.x * 1.31 + p.z * 1.05 - uTime * 2.7) * 0.029;
  float dz = cos(p.z * 0.31 - uTime * 1.1) * 0.028 + cos((p.x + p.z) * 0.13 + uTime * 0.7) * 0.009
           - cos(p.x * 0.85 - p.z * 0.62 + uTime * 2.1) * 0.019
           + cos(p.x * 1.31 + p.z * 1.05 - uTime * 2.7) * 0.023;
  vN = normalize(vec3(-dx, 1.0, -dz));
  vW = p;
  gl_Position = uVP * vec4(p, 1.0);
}`;

export const WATER_FS = /* glsl */`#version 300 es
precision highp float;
in vec3 vW; in vec3 vN;
uniform vec3 uEye;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmb;
uniform vec3 uSkyTop;
uniform vec3 uSkyHor;
${FOG}
out vec4 frag;
void main(){
  vec3 n = normalize(vN);
  vec3 view = normalize(uEye - vW);
  float fres = pow(1.0 - max(dot(n, view), 0.0), 3.0);

  // Vattnet färgas av himlen det speglar i stället för av fasta blåtoner:
  // grått under mulet, brandgult i solnedgång, blått mitt på dagen. Det är
  // det som får sjöarna att höra ihop med tiden på dygnet.
  vec3 refl = mix(uSkyHor, uSkyTop, clamp(0.35 + n.y * 0.4, 0.0, 1.0));
  vec3 deep = vec3(0.02, 0.10, 0.20);
  vec3 body = mix(deep, vec3(0.06, 0.34, 0.46), 0.35) * (uAmb + 0.6);
  vec3 col = mix(body, refl, clamp(fres * 0.85 + 0.06, 0.0, 0.9));

  // en smal spegelbild av solen, plus glitter från de korta krusningarna
  vec3 hv = normalize(uSunDir + view);
  float spec = max(dot(n, hv), 0.0);
  col += uSunCol * pow(spec, 220.0) * 2.0;
  col += uSunCol * pow(spec, 26.0) * 0.10;
  col += uSunCol * fres * 0.14;

  float dist = distance(vW, uEye);
  col = applyFog(col, dist);
  frag = vec4(col, 0.78 + fres * 0.20);
}`;
