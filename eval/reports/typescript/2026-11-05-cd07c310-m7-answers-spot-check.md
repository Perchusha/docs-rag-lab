# Judge spot check: 10 answers labelled

Report: `cd07c310`, m7-answers, 2026-11-05T23:19:32.145Z. It allows 1 disagreement on each dimension it compares (ADR-0016), and it is no calibration round: it decides nothing for any other report.

| Dimension | Agreed | Compared | Cohen's kappa | 95% interval | Passed |
| --- | --- | --- | --- | --- | --- |
| correctness | 7 | 9 | 0.64 | 45% to 94% | no |
| refusal | 10 | 10 | 1.00 | 72% to 100% | yes |
| support | 6 | 7 | 0.59 | 49% to 97% | yes |

Disagreements on correctness:

- ts-0047, row 3: human 2, judge 1
- ts-0046, row 3: human 2, judge 1

Disagreements on citations:

- ts-0047, row 3: human unsupported, judge supported

This spot check missed, so the work stops and the owner is asked (ADR-0016).
