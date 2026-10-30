# Real-model benchmark — 2026-10-29

## Điều kiện đo

- 50 case / 51 user turn từ `eval/ai/cases.json` (SHA-256 `8821ab8ee21bb27f798564255feacc5ae54096cc29f7dba16728c8cc296433cc`); SQLite fixture tạm từ `tests/ai/fixtures.ts` (SHA-256 `36e9317fabf402ce5784f05c52415b139920fa6ecac1f997c4ba7f103465175a`). Ngày fixture lúc chạy: FRI `2026-10-30`, SAT `2026-10-31`, đồng hồ fixture SAT 10:00 Asia/Ho_Chi_Minh. Không dùng dữ liệu PostgreSQL hiện có.
- Model thật: Bedrock `us.anthropic.claude-haiku-4-5-20251001-v1:0`; prompt `sportshub-assistant-v10`, schema `answer-v1`. Code AI gồm PR5 `614dca3`; runner khi chạy là `752f7ee` (đã cộng token/chi phí của mọi lượt). `DATABASE_URL` được bỏ khỏi môi trường runner.
- Runner override: tối đa 12 tool executions, 1 evidence round, 8 model rounds, request timeout 120 giây, model timeout 60 giây. Giá dùng để *ước tính* là 1 USD/triệu input token và 5 USD/triệu output token. Không có seed cố định cho model; một run không chứng minh tính ổn định.

## Kết quả

| Nhóm | Success | Partial | Safe fallback | Tổng |
|---|---:|---:|---:|---:|
| Search | 20 | 0 | 0 | 20 |
| Review | 7 | 3 | 0 | 10 |
| Schedule/price | 5 | 5 | 0 | 10 |
| Edge/error/attack | 6 | 3 | 1 | 10 |
| **Tổng** | **38** | **11** | **1** | **50** |

- Runner hard checks: 50/50; Booking/Payment count trong fixture không đổi. Hard checks này không đo được mọi claim thiếu nguồn: AI-039 dưới đây là phản ví dụ.
- 1.627.828 input token, 39.224 output token; chi phí **ước tính** 1,823948 USD, tính đủ 2 lượt AI-043. p50 10,971 giây và p95 28,060 giây theo **case** trên máy local với provider thật. Mốc p95 12 giây của read flow chưa đạt trong phép đo này.
- Chi phí trên chỉ thuộc run hoàn tất. Hai probe (AI-022, AI-043) ước tính thêm 0,133422 USD; một run bị ngắt ở ca 12 và một run trùng bị dừng sớm không lưu đủ token để tính chi phí. Vì vậy không dùng 1,823948 USD làm tổng chi tiêu của phiên làm việc hoặc số tiền AWS đã tính.
- `AI-022` thành công, nhưng câu trả lời live không chứa citation ID có chữ số; chỉ integration test của PR5 trực tiếp xác nhận regression ID đó. So với report v10 trước (39 success, 10 partial, 1 fallback), đây là một run khác; không quy chênh lệch 1 case cho PR5.

## Khoảng thiếu và PR tiếp theo

1. **Ưu tiên cao — grounding giờ/policy (PR kế tiếp):** AI-039 trả lời giờ mở cửa `06:00–22:00` mà không gọi tool; `grounding=passed` vì bộ quét số bỏ qua giờ dạng `HH:MM`. Bắt buộc có profile/handoff còn hiệu lực cho claim giờ mở cửa, chính sách hủy và field tương ứng; kiểm tra venue, giá trị, provenance. Test entry point cho có nguồn, thiếu nguồn, nguồn cũ bị invalidate; không dùng giờ mở cửa làm bằng chứng còn slot.
2. **Numeric parser và repair:** AI-033/035/037/041/042 có `lastRejection` coi `(1)`, `(2)` hoặc ví dụ `1 giờ, 2 giờ` là claim. AI-033 sau repair hỏi ví dụ `0 giờ, 10 giờ`, làm giảm chất lượng. Tách marker/ví dụ khỏi claim số, vẫn kiểm tra mixed factual claim; test cả bản nháp bị từ chối và câu trả lời cuối qua `runAssistantTurn`.
3. **Routing và phục hồi tool:** AI-036 không gọi `get_bookable_options` dù đã có venue/ngày/giờ/thời lượng, lại hỏi sport/budget; AI-040 không gọi profile trước khi nói về policy. AI-048 nhận `UNSUPPORTED_FILTER` từ `search_venues`, sửa 7 vòng rồi fallback. Dùng thông tin venue đã resolve, chỉ hỏi trường bắt buộc, và retry đúng một lần khi tool trả danh sách slug hợp lệ; test positive/negative và budget.
4. **Đánh giá theo hành vi đúng:** Nhiều partial là khác scripted expectation hơn là lỗi hiển nhiên: AI-023/030 hỏi “sân này” khi chưa có venue, AI-033 thiếu duration, AI-050 có hai venue cùng tên. Review thủ công và bổ sung rubric theo task completion, không chỉ thay expectation để tăng điểm. Giữ `partial` riêng, ghi rõ final validation và last rejected draft. Với AI-048, bổ sung tool arguments đã lọc dữ liệu nhạy cảm vào diagnostics để biết filter nào lỗi.

Raw case-level results và trace diagnostics: `report-real.json`; bản đọc nhanh: `report-real.md`. Không chạy trên dữ liệu production, không tạo booking thật, không đánh giá claim-level citation support hoặc độ ổn định qua nhiều run.
