# Real-model benchmark — 2026-10-30

## Điều kiện đo

50 case / 51 user turn, cùng thứ tự và case ID với baseline PR6 ngày 2026-10-29. Model thật: Bedrock `us.anthropic.claude-haiku-4-5-20251001-v1:0`, prompt `sportshub-assistant-v10`. Không có seed model cố định; đồng hồ thực, fixture SAT `2026-10-31`, FRI `2026-10-30`.

Checkout đo là PR8 `d573aac` cộng đúng một dòng loại citation khỏi numeric prose của PR5 `614dca3`, dùng runner PR6 (blob `d06d80211967a9701f20a29318597ff18dde63a8`). Đây là overlay local, chưa merge PR. Không chứa các thử nghiệm numeric parser hoặc slot-routing guard bị review từ chối.

Runner dùng SQLite fixture tạm, bỏ `DATABASE_URL`; không sử dụng PostgreSQL hiện có. Giới hạn: 12 tool executions, 1 evidence round, 8 model rounds, request 120 giây, model 60 giây, output 2048 token, tổng 150000 token/turn. Giá ước tính: 1 USD/triệu input và 5 USD/triệu output token; không phải hóa đơn AWS.

SHA-256 để tái lập:

| Artifact | SHA-256 |
|---|---|
| cases.json | `8821ab8ee21bb27f798564255feacc5ae54096cc29f7dba16728c8cc296433cc` |
| fixtures.ts | `36e9317fabf402ce5784f05c52415b139920fa6ecac1f997c4ba7f103465175a` |
| prompts.ts | `f60c4f3fff8be84ca88790bb18921e4a1aa508fd31a91956e4a6817554cb0577` |
| orchestrator.ts đã overlay | `198e8e6e2248e88add8587e11d05399c83e6a0c9ea7b79bc3f14c448855c2e78` |
| report-real.json local | `c607f6f0b58a9018ba6b01c17f5ad763bdf87608f9428943128db36054f71005` |

Cases và fixture có cùng checksum với baseline. Report hoàn tất lúc `2026-10-30T07:08:27.322Z`; raw report giữ local, không đưa vào PR này.

## Kết quả

| Chỉ số | Baseline 2026-10-29 | Run 2026-10-30 |
|---|---:|---:|
| Success | 38 | 42 |
| Partial | 11 | 6 |
| Safe fallback | 1 | 2 |
| Fail hard checks | 0 | 0 |
| Safety hard checks | 50/50 | 50/50 |
| p95 theo case | 28060 ms | 25358 ms |
| Chi phí ước tính run hoàn tất | $1.823948 | $1.748043 |

Run mới: search 20 success; review 6 success / 3 partial / 1 fallback; schedule 8 success / 2 partial; edge 8 success / 1 partial / 1 fallback. Tổng 1564798 input và 36649 output token, p50 9632 ms. Có 62 repair trên 36 case, tối đa 7 repair/case. Booking/Payment count trong fixture không đổi.

Các chuyển trạng thái: AI-035/039/040/042 từ partial sang success; AI-048 từ fallback sang success; AI-028 từ success sang fallback; AI-050 từ partial sang fallback. AI-039/040 phù hợp mục tiêu grounding của PR7/8, nhưng một run mỗi phiên bản chưa chứng minh quan hệ nhân quả hoặc độ ổn định. Hard checks không chấm đầy đủ mọi claim và không đồng nghĩa 42 câu trả lời hoàn toàn đúng.

Probe lại riêng AI-028/050 cho kết quả success/partial, không fallback: hai fallback không tái diễn trong probe đó. Probe riêng AI-023/027/033/036/041 vẫn cho 5 partial. Các probe này có chi phí riêng; không dùng chi phí full run làm tổng chi tiêu phiên làm việc.

## Gap và PR tiếp theo

1. **Entity resolution và routing AI-036:** cả full run và probe đều hỏi sport/budget rồi dừng dù đã có tên sân và khung chơi. Cần resolve từ dữ liệu public/tool registry trước khi quyết định hỏi gì. Thử nghiệm đoán địa điểm bằng regex bị rút sau review: “ở đây”, “ở Sân Nào” có thể bị coi là địa điểm. Test phải có thiếu địa điểm, tên mơ hồ, hidden venue và tool error; không ép search không bộ lọc.
2. **Numeric clarification:** AI-033/041 vẫn bắt nhầm marker và ví dụ thời lượng. Thử nghiệm bỏ số theo từ khóa câu hỏi bị rút vì có thể che claim “sân còn (2) giờ”. Hướng tiếp theo là render trường cần hỏi từ cấu trúc đã validate hoặc phân loại span có nguồn; giữ nguyên grounding của prose tự do. PR này thêm regression qua `runAssistantTurn` cho các claim từng lọt trong thử nghiệm.
3. **Audit rubric trước khi đổi điểm:** AI-023/030 nói “sân này” nhưng không có referent; AI-033 thiếu duration; AI-041 thiếu ngày/thời lượng. Clarification có cơ sở. AI-027 search card đã chứa `googleRating=null` và số in-app, trong khi rubric buộc profile. Cần xác định task completion và nguồn đủ dùng, sửa input/expectation có lý do và version mới; không hồi tố tăng điểm run này.
4. **Repair theo loại lỗi:** AI-028 nhận stats `NOT_PUBLIC`, sau đó search nhưng full run hết vòng; AI-050 hết vòng với schema không hợp lệ. Cần diagnostics theo từng attempt, tách schema/reference/grounding và retry có giới hạn sau resolve. Không tăng budget để che vòng lặp.

## Giới hạn và rollback

Chưa đo PostgreSQL, catalog thật, UI/E2E hoặc production. Không đạt bằng chứng để tuyên bố AI Assistant đã hoàn thiện hay production-ready. p95 vẫn vượt mục tiêu read flow 12 giây. Các nhánh thử nghiệm parser/routing giữ local và không nằm trong PR này.

PR chỉ thêm báo cáo và safety regression tests; không đổi runtime, API, schema hoặc dữ liệu. Rollback bằng revert commit của PR. Gate: các test mới qua entry point thật, suite ở UTC/Asia_Ho_Chi_Minh và typecheck; kết quả chạy được ghi trong PR description.
