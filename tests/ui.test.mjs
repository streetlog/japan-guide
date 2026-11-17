/* streetlog-japan-guide-open 동작 검증 (jsdom)
   실행: NODE_PATH=../../.cache/build/node_modules node tests/ui.test.mjs */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// jsdom 은 `npm i -D jsdom` 후 쓰거나, 이미 설치된 경로를 JSDOM_PATH 로 지정
const require = createRequire(import.meta.url);
let jsdomMod;
try {
  jsdomMod = require("jsdom");
} catch (e) {
  jsdomMod = require(path.resolve(process.env.JSDOM_PATH || path.join(root, "node_modules/jsdom")));
}
const { JSDOM, VirtualConsole } = jsdomMod;

const DATA_SRC = fs.readFileSync(path.join(root, "data.js"), "utf8");
const { PLACES, REGIONS, SHOPPING } = new Function(
  DATA_SRC + "\nreturn { PLACES, REGIONS, SHOPPING };"
)();
const countType = (type) => PLACES.filter((p) => p.type === type).length;
const FOOD = countType("맛집");
const byId = (id) => PLACES.filter((p) => p.id === id)[0];

const html = fs.readFileSync(path.join(root, "index.html"), "utf8")
  // <script src="data.js"> 를 인라인으로 바꿔 파일 로딩 없이 같은 조건으로 실행
  .replace('<script src="data.js"></script>', `<script>${DATA_SRC}</script>`);

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push(String(e.message || e)));
vc.on("error", (m) => errors.push(String(m)));

const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://streetlog.test/", virtualConsole: vc, pretendToBeVisual: true });
const { window } = dom;
const { document } = window;

window.Element.prototype.scrollIntoView = function () {};
window.confirm = () => true;
let opened = null;
window.open = (url) => { opened = url; return null; };
let copied = null;
Object.defineProperty(window.navigator, "clipboard", {
  value: { writeText: (t) => { copied = t; return Promise.resolve(); } },
  configurable: true,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
const fails = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fails.push(name + (extra ? ` — ${extra}` : "")); console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`); }
}
const $ = (s) => document.querySelector(s);
const cards = () => document.querySelectorAll("#grid [data-card]");
const text = (s) => ($(s) ? $(s).textContent.trim() : "");
const ls = () => JSON.parse(window.localStorage.getItem("streetlog.list.v1") || "{}");
const courseRows = () => [...document.querySelectorAll("#courseBody .route-row")];
const routeOrder = () => courseRows().map((r) => r.getAttribute("data-row").split(":")[1]);

/* 테스트용 거리 계산 (앱과 같은 하버사인) */
const rad = (d) => (d * Math.PI) / 180;
const km = (a, b) => {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
};
/* 출발지를 고정한 최소 경로 (완전 탐색) */
function bestPath(startId, ids) {
  const rest = ids.filter((id) => id !== startId);
  let best = Infinity, bestOrder = null;
  const perm = (arr, acc) => {
    if (!arr.length) {
      let total = 0, prev = startId;
      for (const id of acc) { total += km(byId(prev), byId(id)); prev = id; }
      if (total < best) { best = total; bestOrder = [startId].concat(acc); }
      return;
    }
    arr.forEach((id, i) => perm(arr.slice(0, i).concat(arr.slice(i + 1)), acc.concat(id)));
  };
  perm(rest, []);
  return { total: best, order: bestOrder };
}
const num = (t) => Number(String(t).replace(/[^\d.]/g, ""));

console.log("\n[1] 초기 렌더링");
check("제목 표시", document.title.includes("streetlog.kr"));
check("여행 카드 12장 렌더(첫 페이지)", cards().length === 12, `실제 ${cards().length}`);
check(`총 개수 표시 '총 ${FOOD}곳'`, text("#resultCount") === `총 ${FOOD}곳`, text("#resultCount"));
check(`지역 필터 ${REGIONS.length}개`, document.querySelectorAll("#pills .pill").length === REGIONS.length,
  String(document.querySelectorAll("#pills .pill").length));
check("필터 순서 = REGIONS", [...document.querySelectorAll("#pills .pill")].map((b) => b.getAttribute("data-filter")).join(",") === REGIONS.join(","),
  [...document.querySelectorAll("#pills .pill")].map((b) => b.getAttribute("data-filter")).join(","));
check("도쿠시마 필터 개수 4", /도쿠시마\s*4/.test(text("#pills")), text("#pills").replace(/\s+/g, " "));
check("첫 카드 = 데이터 첫 항목", $("[data-card]").getAttribute("data-card") === PLACES.filter((p) => p.type === "맛집")[0].id);
check("첫 카드 일본어명 표기", $("[data-card]").textContent.includes(PLACES[0].ja));
check("지도 버튼 href", $('[data-card] a.btn').getAttribute("href").startsWith("https://www.google.com/maps/search/?api=1&query="));
check("배너는 여행 탭에서 숨김", $("#banner").hidden === true);

console.log("\n[2] 필터 / 검색");
$('#pills [data-filter="도쿠시마"]').click();
check("도쿠시마 맛집 4곳", text("#resultCount") === "총 4곳", text("#resultCount"));
check("도쿠시마 카드 4장", cards().length === 4, String(cards().length));
$('#pills [data-filter="전체"]').click();
const q = $("#q");
q.value = "라멘";
q.dispatchEvent(new window.Event("input", { bubbles: true }));
await sleep(200);
const ramenCount = cards().length;
check("검색 '라멘' 결과 있음", ramenCount > 0 && ramenCount < 12, `카드 ${ramenCount}`);
q.value = "존재하지않는검색어";
q.dispatchEvent(new window.Event("input", { bubbles: true }));
await sleep(200);
check("결과 없을 때 빈 상태", document.querySelector("#grid .empty") !== null);
$("#clearQ").click();
await sleep(50);
check("검색어 지우면 복귀", document.querySelectorAll("#grid [data-card]").length === 12);

console.log("\n[3] 더 보기");
let guard = 0;
while ($("#moreBtn") && !$("#moreBtn").hidden && guard++ < 10) { $("#moreBtn").click(); }
check(`더 보기 후 맛집 ${FOOD}장 전부`, cards().length === FOOD, `실제 ${cards().length}`);

console.log("\n[4] 하단 바 — 쇼핑 / 여행 코스 분리");
check("처음 쇼핑 0개 · ¥0", text("#shopBarTitle") === "쇼핑 0개" && text("#shopBarSub") === "약 ¥0", `${text("#shopBarTitle")} / ${text("#shopBarSub")}`);
check("처음 여행 코스 0곳 · 루트 보기", text("#courseBarTitle") === "여행 코스 0곳" && text("#courseBarSub") === "루트 보기", `${text("#courseBarTitle")} / ${text("#courseBarSub")}`);
check("두 영역이 따로 존재", $("#shopBar") !== null && $("#courseBar") !== null);
$('[data-card="ty-01"] [data-act="add"]').click();
check("장소 담으면 여행 코스 1곳", text("#courseBarTitle") === "여행 코스 1곳", text("#courseBarTitle"));
check("장소 담아도 쇼핑은 0개", text("#shopBarTitle") === "쇼핑 0개", text("#shopBarTitle"));
check("좌표가 함께 저장됨", typeof ls().travel["ty-01"].lat === "number" && typeof ls().travel["ty-01"].lng === "number",
  JSON.stringify(ls().travel["ty-01"]));
$('[data-card="ty-01"] [data-act="add"]').click();
check("중복 담기 막힘", Object.keys(ls().travel).length === 1);

console.log("\n[5] 일본어 복사");
$('[data-card="ty-01"] [data-act="copy"]').click();
await sleep(80);
check("복사된 값 = 阿夫利 原宿本店", copied === "阿夫利 原宿本店", String(copied));
check("버튼 피드백 '복사됨'", $('[data-card="ty-01"] [data-act="copy"]').textContent.includes("복사됨"));

console.log("\n[6] 쇼핑 탭 + 합계");
$("#tabShopping").click();
check("쇼핑 카드 12개", cards().length === 12, `실제 ${cards().length}`);
check("상품 수 표기", text("#resultCount") === "총 12개 상품", text("#resultCount"));
check("배너 표시", $("#banner").hidden === false);
$('[data-card="sp-01"] [data-act="add"]').click();
check("쇼핑 담으면 쇼핑 1개 · 여행 코스는 1곳 그대로", text("#shopBarTitle") === "쇼핑 1개" && text("#courseBarTitle") === "여행 코스 1곳",
  `${text("#shopBarTitle")} / ${text("#courseBarTitle")}`);
check("쇼핑 금액 약 ¥1,188", text("#shopBarSub") === "약 ¥1,188", text("#shopBarSub"));
$('[data-card="sp-01"] [data-act="add"]').click();
check("같은 상품 재담기 = 수량 2", ls().shopping["sp-01"].qty === 2);
check("수량 반영 약 ¥2,376", text("#shopBarSub") === "약 ¥2,376", text("#shopBarSub"));

console.log("\n[7] 쇼핑 모달 (쇼핑 전용)");
$("#shopBar").click();
check("쇼핑 모달 열림", $("#shopSheet").classList.contains("open") && $("#shopSheet").hidden === false);
check("여행 코스 모달은 닫힘", !$("#courseSheet").classList.contains("open"));
check("쇼핑 행 1개만", document.querySelectorAll("#shopBody [data-row]").length === 1,
  String(document.querySelectorAll("#shopBody [data-row]").length));
check("쇼핑 모달에 장소 행 없음", document.querySelectorAll('#shopBody [data-row^="travel:"]').length === 0);
check("모달 제목에 개수 표시", text("#shopTitle").includes("쇼핑 리스트 1개"), text("#shopTitle"));
const shopRow = () => document.querySelector('#shopBody [data-row="shopping:sp-01"]');
shopRow().querySelector("[data-chk]").click();
check("구매 완료 체크 저장", ls().shopping["sp-01"].checked === true && shopRow().classList.contains("on"));
shopRow().querySelector('[data-step="1"]').click();
check("수량 + → 3", ls().shopping["sp-01"].qty === 3 && text("#shopTotal") === "약 ¥3,564", text("#shopTotal"));
shopRow().querySelector('[data-step="-1"]').click();
shopRow().querySelector('[data-step="-1"]').click();
shopRow().querySelector('[data-step="-1"]').click();
check("수량 최소 1 유지", ls().shopping["sp-01"].qty === 1);
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
check("ESC 로 쇼핑 모달 닫힘", $("#shopSheet").classList.contains("open") === false);

console.log("\n[8] 여행 코스 모달 — 최단 동선 · 구간 거리 · 구글 지도 루트");
/* 도쿄 4곳 (센소지 → 시부야 스카이 → 도쿄 타워 → 메이지 신궁 순서로 담기) */
$("#tabSight").click();
let g2 = 0;
while ($("#moreBtn") && !$("#moreBtn").hidden && g2++ < 10) { $("#moreBtn").click(); }
for (const id of ["ty-10", "ty-02", "ty-12", "ty-13"]) {
  $('[data-card="' + id + '"] [data-act="add"]').click();
}
check("여행 코스 5곳(맛집 1 + 관광지 4)", text("#courseBarTitle") === "여행 코스 5곳", text("#courseBarTitle"));
$("#courseBar").click();
check("여행 코스 모달 열림", $("#courseSheet").classList.contains("open"));
check("번호 1~5 표시", courseRows().map((r) => r.querySelector(".ord").textContent).join(",") === "1,2,3,4,5",
  courseRows().map((r) => r.querySelector(".ord").textContent).join(","));
check("첫 행이 출발지", courseRows()[0].classList.contains("start") && courseRows()[0].querySelector(".leg").textContent.includes("출발지"));
check("구간 거리는 '약 X.Xkm'", courseRows().slice(1).every((r) => /약 \d+\.\dkm/.test(r.querySelector(".leg").textContent)),
  courseRows().map((r) => r.querySelector(".leg").textContent).join(" | "));

const optimal = bestPath("ty-01", ["ty-01", "ty-10", "ty-02", "ty-12", "ty-13"]);
check("자동 정렬이 최소 거리와 일치(5곳 완전탐색 대조)", Math.abs(num(text("#courseTotal")) - optimal.total) < 0.15,
  `${text("#courseTotal")} vs 최적 ${optimal.total.toFixed(1)}km`);
check("첫 출발지 = 처음 담은 장소", routeOrder()[0] === "ty-01", routeOrder().join(","));

const legsSum = courseRows().slice(1).reduce((a, r) => a + num(r.querySelector(".leg").textContent), 0);
check("구간 거리 합 = 총 이동 거리", Math.abs(legsSum - num(text("#courseTotal"))) < 0.3,
  `${legsSum.toFixed(1)} vs ${text("#courseTotal")}`);

$("#routeOpen").click();
check("구글 지도 루트 URL 형식", /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=[\d.]+,[\d.]+&destination=[\d.]+,[\d.]+&waypoints=[\d.]+,[\d.]+\|/.test(opened || ""), String(opened));
{
  const u = new URL(opened);
  const origin = u.searchParams.get("origin").split(",").map(Number);
  const dest = u.searchParams.get("destination").split(",").map(Number);
  const wp = u.searchParams.get("waypoints").split("|").map((s) => s.split(",").map(Number));
  const first = byId(routeOrder()[0]);
  const last = byId(routeOrder()[routeOrder().length - 1]);
  check("origin = 1번 장소 좌표", Math.abs(origin[0] - first.lat) < 1e-4 && Math.abs(origin[1] - first.lng) < 1e-4, `${origin} vs ${first.lat},${first.lng}`);
  check("destination = 마지막 장소 좌표", Math.abs(dest[0] - last.lat) < 1e-4 && Math.abs(dest[1] - last.lng) < 1e-4, `${dest} vs ${last.lat},${last.lng}`);
  check("waypoints 개수 = 중간 장소 수", wp.length === routeOrder().length - 2, `${wp.length}`);
  check("waypoints 순서 = 화면 순서", wp.every((p, i) => {
    const row = byId(routeOrder()[i + 1]);
    return Math.abs(p[0] - row.lat) < 1e-4 && Math.abs(p[1] - row.lng) < 1e-4;
  }));
}

console.log("\n[9] 출발지 변경 · 개별 삭제");
const before = routeOrder().join(",");
courseRows()[2].click();
const after = routeOrder().join(",");
check("탭한 장소가 1번으로", after.split(",")[0] === before.split(",")[2], `${before} → ${after}`);
check("출발지가 저장됨", ls().start === after.split(",")[0], String(ls().start));
check("출발지 변경 후에도 5곳", courseRows().length === 5);
check("출발지 변경 후 거리 재계산", num(text("#courseTotal")) > 0 && Math.abs(num(text("#courseTotal")) - num(courseRows().slice(1).reduce((a, r) => a + num(r.querySelector(".leg").textContent), 0))) < 0.3);
courseRows()[4].querySelector(".del").click();
check("개별 삭제 반영", courseRows().length === 4 && text("#courseBarTitle") === "여행 코스 4곳",
  `${courseRows().length} / ${text("#courseBarTitle")}`);
check("삭제 시 동선도 다시 계산", courseRows().map((r) => r.querySelector(".ord").textContent).join(",") === "1,2,3,4");

console.log("\n[10] 한 곳만 담았을 때");
const delAll = () => { while (courseRows().length) courseRows()[0].querySelector(".del").click(); };
delAll();
$("#courseBar").click();
$("#tabFood").click();
$('#pills [data-filter="도쿠시마"]').click();
$('[data-card="tk-01"] [data-act="add"]').click();
$("#courseBar").click();
check("1곳이면 거리 계산 전", text("#courseTotal") === "2곳부터 계산", text("#courseTotal"));
check("1곳 안내 문구", $("#courseBody").textContent.includes("2곳 이상 담으면"), $("#courseBody").textContent.slice(0, 60));
$("#routeOpen").click();
check("1곳은 단일 장소 길찾기 링크", /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=[\d.]+,[\d.]+$/.test(opened || ""), String(opened));

console.log("\n[11] 비우기 (그룹별)");
$("#shopBar").click();
$("#clearShopping").click();
check("쇼핑만 비우고 코스는 유지", text("#shopBarTitle") === "쇼핑 0개" && text("#courseBarTitle") === "여행 코스 1곳",
  `${text("#shopBarTitle")} / ${text("#courseBarTitle")}`);
check("쇼핑 모달 빈 상태", $("#shopBody").textContent.includes("아직 담은 상품이 없어요"));
$("#courseBar").click();
$("#clearCourse").click();
check("코스 비우면 0곳", text("#courseBarTitle") === "여행 코스 0곳" && ls().start === "", text("#courseBarTitle"));
check("코스 모달 빈 상태", $("#courseBody").textContent.includes("아직 담은 장소가 없어요"));

console.log("\n[12] 장소 카드 썸네일");
check("모든 장소에 img 필드(상대 경로)", PLACES.every((p) => p.img === `./images/places/${p.id}.jpg`),
  PLACES.filter((p) => p.img !== `./images/places/${p.id}.jpg`).map((p) => p.id).join(","));
check("장소 이미지 158장 모두 파일 존재", PLACES.every((p) => fs.existsSync(path.join(root, "images", "places", p.id + ".jpg"))),
  PLACES.filter((p) => !fs.existsSync(path.join(root, "images", "places", p.id + ".jpg"))).map((p) => p.id).join(","));
for (const [tab, label, type] of [["tabFood", "맛집", "맛집"], ["tabCafe", "카페", "카페"], ["tabSight", "관광지", "명소"], ["tabHotel", "호텔", "호텔"]]) {
  $("#" + tab).click();
  const all = $("#pills [data-filter=\"전체\"]");
  if (all && all.getAttribute("aria-pressed") !== "true") all.click();
  await sleep(60);
  const list = [...cards()];
  const imgs = list.map((c) => c.querySelector("img.thumb"));
  check(`${label} 탭 카드마다 썸네일`, list.length > 0 && imgs.every((i) => i !== null), `카드 ${list.length}장`);
  check(`${label} 썸네일 src = 이미지 경로`, list.every((c, i) => imgs[i] && imgs[i].getAttribute("src") === `./images/places/${c.getAttribute("data-card")}.jpg`),
    (imgs[0] || {}).getAttribute && imgs[0].getAttribute("src"));
  check(`${label} 썸네일 alt 에 장소명`, imgs[0] && imgs[0].getAttribute("alt").length > 4, String(imgs[0] && imgs[0].getAttribute("alt")));
}
check("썸네일 72×72 · lazy · async", (() => {
  const i = $("[data-card] img.thumb");
  return i && i.getAttribute("width") === "72" && i.getAttribute("height") === "72" &&
    i.getAttribute("loading") === "lazy" && i.getAttribute("decoding") === "async" && i.classList.contains("thumb");
})());
check("썸네일 CSS(72px·12px 라운드·cover)", /\.thumb\s*\{[^}]*width:\s*72px[^}]*border-radius:\s*12px[^}]*object-fit:\s*cover/.test(html.replace(/\s+/g, " ")),
  (html.match(/\.thumb[^}]*\}/) || [""])[0].slice(0, 80));

console.log("\n[13] 콘솔 오류");
check("자바스크립트 오류 없음", errors.length === 0, errors.join(" | "));

console.log(`\n결과: ${pass} 통과 / ${fails.length} 실패`);
if (fails.length) { fails.forEach((f) => console.log(" - " + f)); process.exit(1); }
