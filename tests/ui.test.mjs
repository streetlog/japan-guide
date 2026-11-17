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
const DOKUSHIMA_FOOD = PLACES.filter((p) => p.type === "맛집" && p.region === "도쿠시마").length;
const PAGE = 12;
const MORE = 24;

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
check(`도쿠시마 필터 개수 ${DOKUSHIMA_FOOD}`, new RegExp("도쿠시마\\s*" + DOKUSHIMA_FOOD + "(?!\\d)").test(text("#pills")), text("#pills").replace(/\s+/g, " ").slice(0, 200));
check("첫 카드 = 데이터 첫 항목", $("[data-card]").getAttribute("data-card") === PLACES.filter((p) => p.type === "맛집")[0].id);
check("첫 카드 일본어명 표기", $("[data-card]").textContent.includes(PLACES[0].ja));
check("지도 버튼 href", $('[data-card] a.btn').getAttribute("href").startsWith("https://www.google.com/maps/search/?api=1&query="));
check("배너는 여행 탭에서 숨김", $("#banner").hidden === true);

console.log("\n[2] 필터 / 검색");
$('#pills [data-filter="도쿠시마"]').click();
check(`도쿠시마 맛집 ${DOKUSHIMA_FOOD}곳`, text("#resultCount") === `총 ${DOKUSHIMA_FOOD}곳`, text("#resultCount"));
check(`도쿠시마 카드 ${Math.min(PAGE, DOKUSHIMA_FOOD)}장(첫 페이지)`, cards().length === Math.min(PAGE, DOKUSHIMA_FOOD), String(cards().length));
$('#pills [data-filter="전체"]').click();
const q = $("#q");
q.value = "라멘";
q.dispatchEvent(new window.Event("input", { bubbles: true }));
await sleep(200);
const ramenTotal = Number(text("#resultCount").replace(/[^\d]/g, ""));
const ramenCount = cards().length;
check("검색 '라멘' 결과 있음", ramenTotal > 0 && ramenTotal < FOOD, `총 ${ramenTotal}곳 · 카드 ${ramenCount}`);
check("검색 결과도 첫 페이지 12장까지", ramenCount === Math.min(PAGE, ramenTotal), `카드 ${ramenCount}`);
q.value = "존재하지않는검색어";
q.dispatchEvent(new window.Event("input", { bubbles: true }));
await sleep(200);
check("결과 없을 때 빈 상태", document.querySelector("#grid .empty") !== null);
$("#clearQ").click();
await sleep(50);
check("검색어 지우면 복귀", document.querySelectorAll("#grid [data-card]").length === 12);

console.log("\n[3] 더 보기 (한 번에 24곳씩 추가)");
/* 전체 맛집 2,017곳을 다 클릭하면 느리므로, 작은 필터(도쿠시마 맛집)로
   '더 보기'가 모든 항목을 도달하게 하는지 확인하고
   전체 탭의 총 개수는 resultCount 로 따로 확인합니다 */
$('#pills [data-filter="도쿠시마"]').click();
await sleep(60);
check(`도쿠시마 맛집 첫 페이지 ${Math.min(PAGE, DOKUSHIMA_FOOD)}장`, cards().length === Math.min(PAGE, DOKUSHIMA_FOOD), String(cards().length));
check("더 보기 버튼에 남은 개수 표시", /남은\s*\d/.test(text("#moreBtn")), text("#moreBtn"));
check("더 보기 버튼 표시", $("#moreWrap").classList.contains("show"));
let guard = 0;
let grew = true;
while ($("#moreWrap").classList.contains("show") && guard++ < 40) {
  const before = cards().length;
  $("#moreBtn").click();
  await sleep(10);
  if (cards().length <= before) { grew = false; break; }
  if (cards().length > before + MORE) { grew = false; break; }
}
check(`더 보기 후 도쿠시마 맛집 ${DOKUSHIMA_FOOD}장 전부`, cards().length === DOKUSHIMA_FOOD, `실제 ${cards().length} · 클릭 ${guard}회`);
check("더 보기는 24장씩 늘어남", grew);
$("#tabFood").click();
$('#pills [data-filter="전체"]').click();
await sleep(60);
check(`맛집 탭 총 ${FOOD}곳 · 첫 페이지 12장`, text("#resultCount") === `총 ${FOOD}곳` && cards().length === PAGE,
  `${text("#resultCount")} / ${cards().length}장`);
check("큰 목록에서도 더 보기 남은 수 표시", /남은\s*[\d,]+/.test(text("#moreBtn")), text("#moreBtn"));

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

console.log("\n[12] 장소 카드 썸네일 — 기존 195장 유지 · 신규 2,918곳은 사진 없는 텍스트 카드");
const isExistingImg = (p) => /^\.[/]images[/]places[/][a-z]+-\d+\.jpg$/.test(p.img);
const NEW_N = PLACES.length - 195;
$("#tabFood").click();
{
  const all = $('#pills [data-filter="전체"]');
  if (all && all.getAttribute("aria-pressed") !== "true") all.click();
}
await sleep(80);
check("기존 장소 img = ./images/places/{id}.jpg", PLACES.filter(isExistingImg).every((p) => p.img === `./images/places/${p.id}.jpg`),
  PLACES.filter(isExistingImg).filter((p) => p.img !== `./images/places/${p.id}.jpg`).map((p) => p.id).join(","));
check("기존 개별 이미지 195장", PLACES.filter(isExistingImg).length === 195, String(PLACES.filter(isExistingImg).length));
check(`신규 ${NEW_N}곳은 img === ""`, PLACES.filter((p) => !isExistingImg(p)).every((p) => p.img === ""),
  PLACES.filter((p) => !isExistingImg(p) && p.img !== "").map((p) => `${p.id}:${p.img}`).slice(0, 5).join(","));
check("카테고리 대표 이미지(cat-*) 참조 0건", PLACES.every((p) => !/cat-/.test(p.img)),
  PLACES.filter((p) => /cat-/.test(p.img)).map((p) => p.id).slice(0, 5).join(","));
check("기존 195장 파일 모두 존재(그대로 유지)", PLACES.filter(isExistingImg).every((p) => fs.existsSync(path.join(root, "images", "places", p.id + ".jpg"))),
  PLACES.filter((p) => isExistingImg(p) && !fs.existsSync(path.join(root, "images", "places", p.id + ".jpg"))).map((p) => p.id).join(","));
check("images/cat 폴더 정리됨", !fs.existsSync(path.join(root, "images", "cat")));

/* 카드 렌더 — 사진 있는 카드는 썸네일, 없는 카드는 빈 박스 없이 텍스트만 */
const brokenThumbs = () => [...document.querySelectorAll("#grid img.thumb")].filter((i) => {
  const src = i.getAttribute("src");
  return !src || !fs.existsSync(path.join(root, src.replace(/^\.\//, "")));
});
for (const [tab, label] of [["tabFood", "맛집"], ["tabCafe", "카페"], ["tabSight", "관광지"], ["tabHotel", "호텔"], ["tabTransit", "공항·역"]]) {
  $("#" + tab).click();
  const all = $('#pills [data-filter="전체"]');
  if (all && all.getAttribute("aria-pressed") !== "true") all.click();
  await sleep(80);
  const list = [...cards()];
  const withImg = list.filter((c) => byId(c.getAttribute("data-card")).img);
  const noImg = list.filter((c) => !byId(c.getAttribute("data-card")).img);
  check(`${label} 탭 — 사진 있는 카드에만 썸네일`, list.length > 0 && withImg.every((c) => {
    const i = c.querySelector("img.thumb");
    return i && i.getAttribute("src") === byId(c.getAttribute("data-card")).img && !c.classList.contains("no-img");
  }), `카드 ${list.length}장 · 사진 ${withImg.length}장`);
  check(`${label} 탭 — 사진 없는 카드는 img 없이 텍스트 카드`, noImg.every((c) => c.querySelector("img") === null && c.classList.contains("no-img")),
    `사진 없는 카드 ${noImg.length}장`);
  check(`${label} 탭 — 깨진·빈 이미지 0건`, brokenThumbs().length === 0, brokenThumbs().map((i) => i.getAttribute("src")).join(","));
}
$("#tabFood").click();
await sleep(80);
{
  const textCard = [...cards()].find((c) => !byId(c.getAttribute("data-card")).img);
  check("맛집 첫 페이지에 신규 텍스트 카드 있음", !!textCard, `카드 ${cards().length}장`);
  if (textCard) {
    const p = byId(textCard.getAttribute("data-card"));
    check("텍스트 카드 — 지역 뱃지", (textCard.querySelector(".badges .b.region") || {}).textContent === p.region);
    check("텍스트 카드 — 제목", (textCard.querySelector("h3") || {}).textContent === p.ko, p.ko);
    check("텍스트 카드 — 일본어 부제는 제목과 다를 때만", (p.ja !== p.ko) === !!textCard.querySelector("p.ja"), `${p.ja} / ${p.ko}`);
    check("텍스트 카드 — 팁 줄", (textCard.querySelector("p.tip") || {}).textContent === p.tip);
    check("텍스트 카드 — 버튼 3개(일본어 복사·지도 열기·담기)", textCard.querySelectorAll(".acts .btn").length === 3,
      String(textCard.querySelectorAll(".acts .btn").length));
    check("텍스트 카드 — 이미지 요소 없음", textCard.querySelector("img") === null);
  }
  check("텍스트 카드 CSS(.card.no-img) 적용", /\.card\.no-img\s*\{[^}]*gap:\s*0/.test(html.replace(/\s+/g, " ")));
  check("텍스트 카드 — 상단 구분선으로 여백 정리", /\.card\.no-img \.shop-head\s*\{[^}]*border-bottom:\s*1px/.test(html.replace(/\s+/g, " ")));
}
/* 이미지 로드 실패 시에도 깨진 아이콘 대신 텍스트 카드 */
check("이미지 로드 실패 시 텍스트 카드로 전환", (() => {
  const c = [...cards()].find((x) => x.querySelector("img.thumb"));
  if (!c) return false;
  const i = c.querySelector("img.thumb");
  new Function(i.getAttribute("onerror")).call(i);
  return c.classList.contains("no-img") && c.querySelector("img.thumb") === null;
})());
check("썸네일 72×72 · lazy · async", (() => {
  const i = $("#grid [data-card] img.thumb");
  return i && i.getAttribute("width") === "72" && i.getAttribute("height") === "72" &&
    i.getAttribute("loading") === "lazy" && i.getAttribute("decoding") === "async" && i.classList.contains("thumb");
})());
check("썸네일 alt 에 장소명", (() => {
  const c = [...cards()].find((x) => x.querySelector("img.thumb"));
  const i = c && c.querySelector("img.thumb");
  return i && i.getAttribute("alt").length > 4;
})());
check("썸네일 CSS(72px·12px 라운드·cover)", /\.thumb\s*\{[^}]*width:\s*72px[^}]*border-radius:\s*12px[^}]*object-fit:\s*cover/.test(html.replace(/\s+/g, " ")),
  (html.match(/\.thumb[^}]*\}/) || [""])[0].slice(0, 80));

console.log("\n[13] 공항·역 탭 — 10개 지역 · 담기 · 코스 연동");
const TRANSIT = PLACES.filter((p) => p.type === "공항·역");
check("탭 6개", document.querySelectorAll(".tab").length === 6, String(document.querySelectorAll(".tab").length));
check("탭 순서 맛집·카페·관광지·호텔·공항·역·쇼핑리스트",
  [...document.querySelectorAll(".tab")].map((b) => b.getAttribute("data-tab")).join(",") === "food,cafe,sight,hotel,transit,shopping",
  [...document.querySelectorAll(".tab")].map((b) => b.getAttribute("data-tab")).join(","));
check("✈️ 공항·역 탭 버튼", $("#tabTransit") !== null && $("#tabTransit").textContent.includes("공항·역") && $("#tabTransit").textContent.includes("✈️"));
$("#tabTransit").click();
await sleep(80);
check("공항·역 탭 선택 표시", $("#tabTransit").getAttribute("aria-selected") === "true");
check(`공항·역 ${TRANSIT.length}곳`, text("#resultCount") === `총 ${TRANSIT.length}곳`, text("#resultCount"));
check("배너는 공항·역 탭에서 숨김", $("#banner").hidden === true);
check(`지역 필터 ${REGIONS.length}개 유지`, document.querySelectorAll("#pills .pill").length === REGIONS.length,
  String(document.querySelectorAll("#pills .pill").length));
for (const region of REGIONS.slice(1)) {
  const n = TRANSIT.filter((p) => p.region === region).length;
  check(`${region} 공항·역 ${n}곳`, n > 0 && text("#pills").includes(region + n), text("#pills").replace(/\s+/g, " "));
}
$('#pills [data-filter="도쿄"]').click();
await sleep(80);
check("도쿄 공항·역 6곳", text("#resultCount") === "총 6곳", text("#resultCount"));
check("공항·역 카드 썸네일", cards().length === 6 && [...cards()].every((c) => c.querySelector("img.thumb")), `카드 ${cards().length}장`);
check("공항·역 카드 일본어명", $('[data-card="tr-01"]').textContent.includes("成田国際空港"));
{
  const qq = $("#q");
  qq.value = "하네다";
  qq.dispatchEvent(new window.Event("input", { bubbles: true }));
  await sleep(200);
  check("공항·역 탭 검색('하네다')", cards().length === 1 && cards()[0].getAttribute("data-card") === "tr-02", String(cards().length));
  $("#clearQ").click();
  await sleep(80);
}
$('[data-card="tr-01"] [data-act="add"]').click();
check("공항을 담으면 여행 코스 1곳", text("#courseBarTitle") === "여행 코스 1곳", text("#courseBarTitle"));
check("공항 좌표가 코스에 저장", typeof ls().travel["tr-01"].lat === "number" && Math.abs(ls().travel["tr-01"].lat - byId("tr-01").lat) < 1e-9,
  JSON.stringify(ls().travel["tr-01"]));
$('[data-card="tr-05"] [data-act="add"]').click();
$("#tabSight").click();
await sleep(80);
$('#pills [data-filter="도쿄"]').click();
await sleep(80);
$('[data-card="ty-10"] [data-act="add"]').click();
check("공항·역 + 관광지 3곳", text("#courseBarTitle") === "여행 코스 3곳", text("#courseBarTitle"));
$("#courseBar").click();
check("코스 모달 3행", courseRows().length === 3, String(courseRows().length));
check("1번 = 공항(출발지)", routeOrder()[0] === "tr-01" && courseRows()[0].classList.contains("start"), routeOrder().join(","));
{
  const opt = bestPath("tr-01", ["tr-01", "tr-05", "ty-10"]);
  check("공항 출발 최단 동선 = 완전탐색 최소", Math.abs(num(text("#courseTotal")) - opt.total) < 0.15,
    `${text("#courseTotal")} vs 최적 ${opt.total.toFixed(1)}km`);
  check("공항↔시내 거리 반영", num(text("#courseTotal")) > 20, text("#courseTotal"));
}
$("#routeOpen").click();
check("공항 출발 구글 지도 루트 URL", /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=[\d.]+,[\d.]+&destination=[\d.]+,[\d.]+/.test(opened || ""), String(opened));
{
  const u = new URL(opened);
  const origin = u.searchParams.get("origin").split(",").map(Number);
  check("origin = 나리타 공항 좌표", Math.abs(origin[0] - byId("tr-01").lat) < 1e-4 && Math.abs(origin[1] - byId("tr-01").lng) < 1e-4,
    `${origin} vs ${byId("tr-01").lat},${byId("tr-01").lng}`);
}

console.log("\n[13-1] 신규 장소(사진 없음) — 텍스트 카드 · 코스 담기 · 최단 동선 · 루트");
while (courseRows().length) courseRows()[0].querySelector(".del").click();
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
$("#tabFood").click();
const allPill = $('#pills [data-filter="전체"]');
if (allPill && allPill.getAttribute("aria-pressed") !== "true") allPill.click();
await sleep(80);
{
  const textCards = [...cards()].filter((c) => !byId(c.getAttribute("data-card")).img);
  check("맛집 첫 페이지에 신규 장소(텍스트 카드) 있음", textCards.length > 0, `카드 ${cards().length}장 중 ${textCards.length}장`);
  const first = textCards[0];
  const firstId = first.getAttribute("data-card");
  check("신규 카드는 img 태그 없는 텍스트 카드", first.querySelector("img") === null && first.classList.contains("no-img"));
  check("신규 카드도 일본어 복사 버튼·지도 링크 존재", first.querySelector('[data-act="copy"]') !== null && first.querySelector("a.btn") !== null);
  const secondId = textCards[1] ? textCards[1].getAttribute("data-card") : null;
  first.querySelector('[data-act="add"]').click();
  if (secondId) document.querySelector(`[data-card="${secondId}"] [data-act="add"]`).click();
  check("신규 장소 담기 → 코스에 저장", text("#courseBarTitle") === `여행 코스 ${secondId ? 2 : 1}곳`, text("#courseBarTitle"));
  check("신규 장소 좌표도 저장", typeof ls().travel[firstId].lat === "number" && Math.abs(ls().travel[firstId].lat - byId(firstId).lat) < 1e-9);
  $("#courseBar").click();
  check("코스 모달에 신규 장소 표시", $("#courseBody").textContent.includes(byId(firstId).ko), byId(firstId).ko);
  check("코스 모달에도 깨진 이미지 없음", document.querySelectorAll("#courseBody img").length === 0);
  if (secondId) {
    check("신규 2곳 최단 동선 계산", num(text("#courseTotal")) > 0 && /^약 [\d.]+km$/.test(text("#courseTotal")), text("#courseTotal"));
    const opt = bestPath(firstId, [firstId, secondId]);
    check("신규 2곳 동선 = 두 좌표 거리", Math.abs(num(text("#courseTotal")) - opt.total) < 0.15,
      `${text("#courseTotal")} vs ${opt.total.toFixed(1)}km`);
    $("#routeOpen").click();
    check("신규 장소 구글 지도 루트 열기", /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=[\d.]+,[\d.]+&destination=[\d.]+,[\d.]+$/.test(opened || ""), String(opened));
  }
  while (courseRows().length) courseRows()[0].querySelector(".del").click();
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}
{
  $("#tabSight").click();
  const sightAll = $('#pills [data-filter="전체"]');
  if (sightAll && sightAll.getAttribute("aria-pressed") !== "true") sightAll.click();
  await sleep(80);
  const qq = $("#q");
  qq.value = "[소품샵]";
  qq.dispatchEvent(new window.Event("input", { bubbles: true }));
  await sleep(200);
  const list = [...cards()];
  check("[소품샵] 검색 결과도 사진 없는 텍스트 카드", list.length > 0 && list.every((c) => c.querySelector("img") === null && c.classList.contains("no-img")),
    `카드 ${list.length}장`);
  qq.value = "[포토스팟]";
  qq.dispatchEvent(new window.Event("input", { bubbles: true }));
  await sleep(200);
  const list2 = [...cards()];
  check("[포토스팟] 검색 결과도 사진 없는 텍스트 카드", list2.length > 0 && list2.every((c) => c.querySelector("img") === null && c.classList.contains("no-img")),
    `카드 ${list2.length}장`);
  $("#clearQ").click();
  await sleep(80);
}

console.log("\n[14] 콘솔 오류");
check("자바스크립트 오류 없음", errors.length === 0, errors.join(" | "));

console.log(`\n결과: ${pass} 통과 / ${fails.length} 실패`);
if (fails.length) { fails.forEach((f) => console.log(" - " + f)); process.exit(1); }
