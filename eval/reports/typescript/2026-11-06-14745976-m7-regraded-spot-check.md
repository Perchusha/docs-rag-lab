# Judge spot check: 10 answers labelled

Report: `14745976`, m7-regraded, 2026-11-06T01:13:27.122Z. It allows 1 disagreement on each dimension it compares (ADR-0016), and it is no calibration round: it decides nothing for any other report.

A fresh spot check, on answers that the spot check of `2026-11-05-cd07c310-m7-answers` did not show, chosen without reading any of this report's verdicts (ADR-0017).

| Dimension | Agreed | Compared | Cohen's kappa | 95% interval | Passed |
| --- | --- | --- | --- | --- | --- |
| correctness | 9 | 10 | 0.63 | 60% to 98% | yes |
| refusal | 10 | 10 | 1.00 | 72% to 100% | yes |
| support | 9 | 10 | 0.00 | 60% to 98% | yes |

Disagreements on correctness:

- ts-0046, row 7: human 1, judge 2

Disagreements on citations:

- ts-0052, row 3: human supported, judge unsupported

This spot check passed.
