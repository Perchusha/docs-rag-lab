# Eval report: answers-regraded

|  |  |
| --- | --- |
| Source | typescript |
| Docs | https://github.com/microsoft/TypeScript-Website, branch v2, `205122bb73dcbf6f3b373de5bdb0d9fa5434d015` |
| Repository | `2184bccc2c565972fbc8153fbee109ed71dc2830` |
| Created | 2026-11-03T12:18:23.187Z |
| Golden set | version 1, `0d270eac9aef` |
| Questions | 40 scored, 5 unanswerable left out, 0 stale, 0 to review |
| Index | chunker 5, parser 1, schema 3, `voyage:voyage-4:1024`, context `none` |
| Retrieval | version 1: topK 8, candidates 50, rrfK 60 |
| Vectors | queries `3cbc8c2527dd`, corpus `8224c2d1af73` |

Retrieval only, with no Claude call. Primary anchors are the headline: acceptable anchors are secondary, because many were found by looking at what the current retrievers return (ADR-0009).

## Primary anchors

| Strategy | Questions | hit@1 | hit@3 | hit@5 | hit@8 | recall@8 | MRR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| vector | 40 | 26 | 34 | 36 | 36 | 0.879 | 0.751 |
| hybrid | 40 | 19 | 34 | 35 | 36 | 0.881 | 0.657 |

## vector against hybrid, primary anchors

Compared question by question with an exact sign test. A difference of one or two questions is noise. Above that, p >= 0.05 is not significant: the smallest splits that are significant are 6:0, 8:1, 10:2, 12:3, 13:4 and 15:5, so a gain of 5 questions with no losses does not reach it. Mixed means the side that won more questions does not have the higher total. A tag with 5 questions or fewer cannot reach significance. With this many tags and metrics, one low p is not proof on its own.

| Metric | vector | hybrid | vector better on | hybrid better on | Tied | p | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| hit@1 | 26 | 19 | 10 | 3 | 27 | 0.092 | not significant |
| hit@3 | 34 | 34 | 3 | 3 | 34 | 1.000 | noise |
| hit@5 | 36 | 35 | 3 | 2 | 35 | 1.000 | noise |
| hit@8 | 36 | 36 | 2 | 2 | 36 | 1.000 | noise |
| recall@8 | 0.879 | 0.881 | 3 | 2 | 35 | 1.000 | noise |
| mrr | 0.751 | 0.657 | 14 | 7 | 19 | 0.189 | not significant |

### Per tag

| Tag | Questions | Metric | vector | hybrid | vector better on | hybrid better on | Tied | p | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| basic | 15 | hit@1 | 10 | 8 | 3 | 1 | 11 | 0.625 | noise |
| basic | 15 | hit@8 | 14 | 14 | 0 | 0 | 15 | 1.000 | noise |
| basic | 15 | mrr | 0.769 | 0.700 | 5 | 3 | 7 | 0.727 | noise |
| cross-lingual | 4 | hit@1 | 3 | 2 | 1 | 0 | 3 | 1.000 | too few to say |
| cross-lingual | 4 | hit@8 | 4 | 3 | 1 | 0 | 3 | 1.000 | too few to say |
| cross-lingual | 4 | mrr | 0.875 | 0.550 | 2 | 0 | 2 | 0.500 | too few to say |
| edge | 14 | hit@1 | 9 | 7 | 3 | 1 | 10 | 0.625 | noise |
| edge | 14 | hit@8 | 13 | 12 | 1 | 0 | 13 | 1.000 | noise |
| edge | 14 | mrr | 0.758 | 0.671 | 5 | 2 | 7 | 0.453 | not significant |
| exact-token | 10 | hit@1 | 7 | 3 | 4 | 0 | 6 | 0.125 | not significant |
| exact-token | 10 | hit@8 | 9 | 10 | 0 | 1 | 9 | 1.000 | noise |
| exact-token | 10 | mrr | 0.767 | 0.617 | 4 | 2 | 4 | 0.688 | noise |
| fresh | 4 | hit@1 | 3 | 1 | 2 | 0 | 2 | 0.500 | too few to say |
| fresh | 4 | hit@8 | 3 | 2 | 1 | 0 | 3 | 1.000 | too few to say |
| fresh | 4 | mrr | 0.757 | 0.409 | 2 | 1 | 1 | 1.000 | too few to say |
| version | 7 | hit@1 | 4 | 3 | 2 | 1 | 4 | 1.000 | noise |
| version | 7 | hit@8 | 6 | 7 | 0 | 1 | 6 | 1.000 | noise |
| version | 7 | mrr | 0.699 | 0.643 | 2 | 1 | 4 | 1.000 | noise |

## vector against hybrid, with acceptable anchors (secondary)

| Metric | vector | hybrid | vector better on | hybrid better on | Tied | p | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| hit@1 | 32 | 27 | 8 | 3 | 29 | 0.227 | not significant |
| hit@3 | 36 | 37 | 1 | 2 | 37 | 1.000 | noise |
| hit@5 | 36 | 37 | 1 | 2 | 37 | 1.000 | noise |
| hit@8 | 36 | 37 | 1 | 2 | 37 | 1.000 | noise |
| mrr | 0.851 | 0.787 | 9 | 5 | 26 | 0.424 | not significant |

## With acceptable anchors (secondary)

| Strategy | Questions | hit@1 | hit@3 | hit@5 | hit@8 | MRR |
| --- | --- | --- | --- | --- | --- | --- |
| vector | 40 | 32 | 36 | 36 | 36 | 0.851 |
| hybrid | 40 | 27 | 37 | 37 | 37 | 0.787 |

## Targets from SPEC section 13

| Question | Anchor | Target | vector | hybrid | Met |
| --- | --- | --- | --- | --- | --- |
| ts-0033 | packages/documentation/copy/en/release-notes/TypeScript 4.9.md#the-satisfies-operator | 1 | 1 | 3 | no |
| ts-0027 | packages/documentation/copy/en/project-config/Compiler Options.md#compiler-options | 6 | 6 | 9 | no |
| ts-0004 | packages/documentation/copy/en/handbook-v2/More on Functions.md#unknown | 2 | 2 | 7 | no |
| ts-0040 | packages/documentation/copy/en/release-notes/TypeScript 5.7.md#typedarrays-are-now-generic-over-arraybufferlike | 8 | - | 3 | yes |
| ts-0040 | packages/documentation/copy/en/handbook-v2/Object Types.md#excess-property-checks | 8 | - | 6 | yes |

## Per question

| Question | Tags | vector, primary | hybrid, primary | vector, with acceptable | hybrid, with acceptable | vector, recall@8 | hybrid, recall@8 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ts-0001 | basic | 4 | 2 | 2 | 2 | 1.000 | 1.000 |
| ts-0002 | basic | 1 | 1 | 1 | 1 | 1.000 | 1.000 |
| ts-0003 | basic | 1 | 1 | 1 | 1 | 1.000 | 1.000 |
| ts-0004 | basic, cross-lingual | 2 | 7 | 1 | 2 | 1.000 | 1.000 |
| ts-0005 | edge | 2 | 2 | 1 | 1 | 1.000 | 1.000 |
| ts-0006 | edge | 1 | 1 | 1 | 1 | 1.000 | 1.000 |
| ts-0007 | edge | 2 | 1 | 2 | 1 | 1.000 | 1.000 |
| ts-0008 | edge | 1 | 1 | 1 | 1 | 1.000 | 1.000 |
| ts-0009 | edge | 1 | 2 | 1 | 2 | 1.000 | 1.000 |
| ts-0010 | basic | 1 | 3 | 1 | 1 | 1.000 | 1.000 |
| ts-0011 | version | 2 | 2 | 1 | 1 | 1.000 | 1.000 |
| ts-0012 | edge | 3 | 4 | 1 | 3 | 1.000 | 1.000 |
| ts-0013 | basic, exact-token | 1 | 1 | 1 | 1 | 1.000 | 1.000 |
| ts-0014 | exact-token, version | 3 | 3 | 1 | 1 | 1.000 | 1.000 |
| ts-0015 | exact-token, version | 1 | 1 | 1 | 1 | 1.000 | 1.000 |
| ts-0016 | cross-lingual, edge | 1 | 1 | 1 | 1 | 1.000 | 1.000 |
| ts-0017 | edge | 1 | 1 | 1 | 1 | 1.000 | 1.000 |
| ts-0018 | edge | 1 | 2 | 1 | 2 | 1.000 | 1.000 |
| ts-0019 | edge | 1 | 1 | 1 | 1 | 1.000 | 1.000 |
| ts-0020 | edge | 1 | 1 | 1 | 1 | 1.000 | 1.000 |
| ts-0021 | basic | 3 | 1 | 3 | 1 | 1.000 | 1.000 |
| ts-0022 | edge | 4 | 15 | 1 | 1 | 1.000 | 0.000 |
| ts-0023 | basic, cross-lingual | 1 | 1 | 1 | 1 | 1.000 | 1.000 |
| ts-0024 | basic | 9 | 40 | 9 | 40 | 0.000 | 0.000 |
| ts-0025 | basic | 1 | 1 | 1 | 1 | 1.000 | 1.000 |
| ts-0026 | version | 1 | 1 | 1 | 1 | 1.000 | 1.000 |
| ts-0027 | basic | 1 | 1 | 1 | 1 | 0.500 | 0.250 |
| ts-0028 | basic, exact-token | 3 | 2 | 2 | 2 | 1.000 | 1.000 |
| ts-0029 | edge, exact-token | 1 | 2 | 1 | 1 | 1.000 | 1.000 |
| ts-0030 | basic, exact-token | 1 | 2 | 1 | 1 | 1.000 | 1.000 |
| ts-0031 | basic, exact-token | 1 | 1 | 1 | 1 | 1.000 | 1.000 |
| ts-0032 | basic, exact-token | 1 | 2 | 1 | 2 | 1.000 | 1.000 |
| ts-0033 | version | 1 | 3 | 1 | 3 | 1.000 | 1.000 |
| ts-0034 | version | 1 | 3 | 1 | 3 | 1.000 | 1.000 |
| ts-0035 | version | 17 | 1 | 17 | 1 | 0.000 | 1.000 |
| ts-0036 | exact-token, fresh | 1 | 2 | 1 | 1 | 1.000 | 1.000 |
| ts-0037 | fresh | 1 | 1 | 1 | 1 | 1.000 | 1.000 |
| ts-0038 | cross-lingual, fresh | 1 | 17 | 1 | 17 | 0.667 | 0.000 |
| ts-0039 | edge, fresh | 36 | 13 | 36 | 13 | 0.000 | 0.000 |
| ts-0040 | exact-token | - | 3 | - | 3 | 0.000 | 1.000 |

## Answers

Answered by `claude-sonnet-5-5`, judged by `claude-opus-5-5`, which does not know the row. This run paid $1.4901 at list prices. The judge is not calibrated until a human has labelled a sample of these answers (`drl eval label`).

| Row | Questions | Correctness, 0-2 | Scored 0 / 1 / 2 | False refusals | Cites an anchor | Claims supported |
| --- | --- | --- | --- | --- | --- | --- |
| row 0 | 40 | 1.850 | 2 / 2 / 36 | 1 | - | - |
| row 2 | 40 | 1.850 | 2 / 2 / 36 | 1 | 35 of 40 | 241 of 243 |
| row 3 | 40 | 1.775 | 3 / 3 / 34 | 2 | 36 of 40 | 236 of 244 |
| row 3 again | 40 | 1.775 | 3 / 3 / 34 | 2 | 36 of 40 | 231 of 234 |

### The questions the docs do not answer

| Row | Questions | Correct refusals | Hallucinations | Wrong |
| --- | --- | --- | --- | --- |
| row 0 | 5 | 5 | 0 | 0 |
| row 2 | 5 | 5 | 0 | 0 |
| row 3 | 5 | 5 | 0 | 0 |
| row 3 again | 5 | 5 | 0 | 0 |

### Correct and grounded (exploratory)

Exploratory: this metric was defined after seeing the first results, and it is no target. An answer counts when it scores 2, every claim it cites is supported, and at least one cited chunk is a primary or acceptable anchor. Row 0 cannot score on it by design, so it shows what retrieval adds beyond memory.

| Row | Questions | Correct and grounded |
| --- | --- | --- |
| row 0 | 40 | - |
| row 2 | 40 | 31 |
| row 3 | 40 | 28 |
| row 3 again | 40 | 32 |

### Latency and cost per question

| Row | Latency, mean | Input tokens | Output tokens | Cost |
| --- | --- | --- | --- | --- |
| row 0 | 3.9 s | 112 | 404 | $0.0043 |
| row 2 | 4.2 s | 8,323 | 492 | $0.0216 |
| row 3 | 4.7 s | 8,765 | 502 | $0.0225 |
| row 3 again | 4.4 s | 8,765 | 494 | $0.0225 |

### Per tag

| Tag | Row | Questions | Correctness, 0-2 | Scored 0 / 1 / 2 | False refusals | Cites an anchor | Claims supported |
| --- | --- | --- | --- | --- | --- | --- | --- |
| basic | row 0 | 15 | 1.933 | 0 / 1 / 14 | 0 | - | - |
| basic | row 2 | 15 | 1.867 | 1 / 0 / 14 | 1 | 14 of 15 | 94 of 95 |
| basic | row 3 | 15 | 1.800 | 1 / 1 / 13 | 1 | 14 of 15 | 96 of 100 |
| basic | row 3 again | 15 | 1.800 | 1 / 1 / 13 | 1 | 14 of 15 | 92 of 94 |
| cross-lingual | row 0 | 4 | 1.500 | 1 / 0 / 3 | 1 | - | - |
| cross-lingual | row 2 | 4 | 1.750 | 0 / 1 / 3 | 0 | 4 of 4 | 31 of 31 |
| cross-lingual | row 3 | 4 | 1.500 | 1 / 0 / 3 | 1 | 3 of 4 | 22 of 23 |
| cross-lingual | row 3 again | 4 | 1.500 | 1 / 0 / 3 | 1 | 3 of 4 | 18 of 18 |
| edge | row 0 | 14 | 1.786 | 1 / 1 / 12 | 0 | - | - |
| edge | row 2 | 14 | 1.786 | 1 / 1 / 12 | 0 | 13 of 14 | 84 of 85 |
| edge | row 3 | 14 | 1.714 | 1 / 2 / 11 | 0 | 13 of 14 | 81 of 83 |
| edge | row 3 again | 14 | 1.714 | 1 / 2 / 11 | 0 | 13 of 14 | 79 of 80 |
| exact-token | row 0 | 10 | 2.000 | 0 / 0 / 10 | 0 | - | - |
| exact-token | row 2 | 10 | 2.000 | 0 / 0 / 10 | 0 | 9 of 10 | 60 of 61 |
| exact-token | row 3 | 10 | 2.000 | 0 / 0 / 10 | 0 | 10 of 10 | 66 of 69 |
| exact-token | row 3 again | 10 | 2.000 | 0 / 0 / 10 | 0 | 10 of 10 | 65 of 67 |
| fresh | row 0 | 4 | 1.000 | 2 / 0 / 2 | 1 | - | - |
| fresh | row 2 | 4 | 1.250 | 1 / 1 / 2 | 0 | 3 of 4 | 30 of 30 |
| fresh | row 3 | 4 | 1.000 | 2 / 0 / 2 | 1 | 2 of 4 | 22 of 23 |
| fresh | row 3 again | 4 | 1.000 | 2 / 0 / 2 | 1 | 2 of 4 | 17 of 17 |
| version | row 0 | 7 | 2.000 | 0 / 0 / 7 | 0 | - | - |
| version | row 2 | 7 | 2.000 | 0 / 0 / 7 | 0 | 5 of 7 | 36 of 36 |
| version | row 3 | 7 | 2.000 | 0 / 0 / 7 | 0 | 6 of 7 | 37 of 38 |
| version | row 3 again | 7 | 2.000 | 0 / 0 / 7 | 0 | 6 of 7 | 41 of 41 |

### row 2 against row 3

| Scope | Questions | Metric | row 2 | row 3 | row 2 better on | row 3 better on | Tied | p | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| overall | 40 | correctness | 1.850 | 1.775 | 3 | 0 | 37 | 0.250 | not significant |
| overall | 40 | citation-accuracy | 0.875 | 0.900 | 1 | 2 | 37 | 1.000 | noise |
| overall | 40 | support | 0.994 | 0.968 | 7 | 0 | 33 | 0.016 | row 2 better |
| overall | 40 | correct-and-grounded (exploratory) | 0.775 | 0.700 | 5 | 2 | 33 | 0.453 | not significant |
| basic | 15 | correctness | 1.867 | 1.800 | 1 | 0 | 14 | 1.000 | noise |
| basic | 15 | citation-accuracy | 0.933 | 0.933 | 0 | 0 | 15 | 1.000 | noise |
| basic | 15 | support | 0.993 | 0.965 | 3 | 0 | 12 | 0.250 | not significant |
| basic | 15 | correct-and-grounded (exploratory) | 0.867 | 0.667 | 3 | 0 | 12 | 0.250 | not significant |
| cross-lingual | 4 | correctness | 1.750 | 1.500 | 1 | 0 | 3 | 1.000 | too few to say |
| cross-lingual | 4 | citation-accuracy | 1.000 | 0.750 | 1 | 0 | 3 | 1.000 | too few to say |
| cross-lingual | 4 | support | 1.000 | 0.938 | 1 | 0 | 3 | 1.000 | too few to say |
| cross-lingual | 4 | correct-and-grounded (exploratory) | 0.750 | 0.750 | 0 | 0 | 4 | 1.000 | too few to say |
| edge | 14 | correctness | 1.786 | 1.714 | 1 | 0 | 13 | 1.000 | noise |
| edge | 14 | citation-accuracy | 0.929 | 0.929 | 0 | 0 | 14 | 1.000 | noise |
| edge | 14 | support | 0.992 | 0.976 | 2 | 0 | 12 | 0.500 | noise |
| edge | 14 | correct-and-grounded (exploratory) | 0.786 | 0.714 | 1 | 0 | 13 | 1.000 | noise |
| exact-token | 10 | correctness | 2.000 | 2.000 | 0 | 0 | 10 | 1.000 | noise |
| exact-token | 10 | citation-accuracy | 0.900 | 1.000 | 0 | 1 | 9 | 1.000 | noise |
| exact-token | 10 | support | 0.989 | 0.968 | 2 | 0 | 8 | 0.500 | noise |
| exact-token | 10 | correct-and-grounded (exploratory) | 0.800 | 0.800 | 1 | 1 | 8 | 1.000 | noise |
| fresh | 4 | correctness | 1.250 | 1.000 | 1 | 0 | 3 | 1.000 | too few to say |
| fresh | 4 | citation-accuracy | 0.750 | 0.500 | 1 | 0 | 3 | 1.000 | too few to say |
| fresh | 4 | support | 1.000 | 0.938 | 1 | 0 | 3 | 1.000 | too few to say |
| fresh | 4 | correct-and-grounded (exploratory) | 0.500 | 0.500 | 0 | 0 | 4 | 1.000 | too few to say |
| version | 7 | correctness | 2.000 | 2.000 | 0 | 0 | 7 | 1.000 | noise |
| version | 7 | citation-accuracy | 0.714 | 0.857 | 0 | 1 | 6 | 1.000 | noise |
| version | 7 | support | 1.000 | 0.976 | 1 | 0 | 6 | 1.000 | noise |
| version | 7 | correct-and-grounded (exploratory) | 0.714 | 0.714 | 1 | 1 | 5 | 1.000 | noise |

### row 0 against row 3

| Scope | Questions | Metric | row 0 | row 3 | row 0 better on | row 3 better on | Tied | p | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| overall | 40 | correctness | 1.850 | 1.775 | 3 | 1 | 36 | 0.625 | noise |
| basic | 15 | correctness | 1.933 | 1.800 | 2 | 1 | 12 | 1.000 | noise |
| cross-lingual | 4 | correctness | 1.500 | 1.500 | 0 | 0 | 4 | 1.000 | too few to say |
| edge | 14 | correctness | 1.786 | 1.714 | 1 | 0 | 13 | 1.000 | noise |
| exact-token | 10 | correctness | 2.000 | 2.000 | 0 | 0 | 10 | 1.000 | noise |
| fresh | 4 | correctness | 1.000 | 1.000 | 0 | 0 | 4 | 1.000 | too few to say |
| version | 7 | correctness | 2.000 | 2.000 | 0 | 0 | 7 | 1.000 | noise |

### row 3 against row 3 again

| Scope | Questions | Metric | row 3 | row 3 again | row 3 better on | row 3 again better on | Tied | p | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| overall | 40 | correctness | 1.775 | 1.775 | 0 | 0 | 40 | 1.000 | noise |
| overall | 40 | citation-accuracy | 0.900 | 0.900 | 0 | 0 | 40 | 1.000 | noise |
| overall | 40 | support | 0.968 | 0.990 | 1 | 5 | 34 | 0.219 | not significant |
| overall | 40 | correct-and-grounded (exploratory) | 0.700 | 0.800 | 0 | 4 | 36 | 0.125 | not significant |
| basic | 15 | correctness | 1.800 | 1.800 | 0 | 0 | 15 | 1.000 | noise |
| basic | 15 | citation-accuracy | 0.933 | 0.933 | 0 | 0 | 15 | 1.000 | noise |
| basic | 15 | support | 0.965 | 0.985 | 1 | 2 | 12 | 1.000 | noise |
| basic | 15 | correct-and-grounded (exploratory) | 0.667 | 0.800 | 0 | 2 | 13 | 0.500 | noise |
| cross-lingual | 4 | correctness | 1.500 | 1.500 | 0 | 0 | 4 | 1.000 | too few to say |
| cross-lingual | 4 | citation-accuracy | 0.750 | 0.750 | 0 | 0 | 4 | 1.000 | too few to say |
| cross-lingual | 4 | support | 0.938 | 1.000 | 0 | 1 | 3 | 1.000 | too few to say |
| cross-lingual | 4 | correct-and-grounded (exploratory) | 0.750 | 0.750 | 0 | 0 | 4 | 1.000 | too few to say |
| edge | 14 | correctness | 1.714 | 1.714 | 0 | 0 | 14 | 1.000 | noise |
| edge | 14 | citation-accuracy | 0.929 | 0.929 | 0 | 0 | 14 | 1.000 | noise |
| edge | 14 | support | 0.976 | 0.988 | 0 | 1 | 13 | 1.000 | noise |
| edge | 14 | correct-and-grounded (exploratory) | 0.714 | 0.786 | 0 | 1 | 13 | 1.000 | noise |
| exact-token | 10 | correctness | 2.000 | 2.000 | 0 | 0 | 10 | 1.000 | noise |
| exact-token | 10 | citation-accuracy | 1.000 | 1.000 | 0 | 0 | 10 | 1.000 | noise |
| exact-token | 10 | support | 0.968 | 0.978 | 1 | 1 | 8 | 1.000 | noise |
| exact-token | 10 | correct-and-grounded (exploratory) | 0.800 | 0.900 | 0 | 1 | 9 | 1.000 | noise |
| fresh | 4 | correctness | 1.000 | 1.000 | 0 | 0 | 4 | 1.000 | too few to say |
| fresh | 4 | citation-accuracy | 0.500 | 0.500 | 0 | 0 | 4 | 1.000 | too few to say |
| fresh | 4 | support | 0.938 | 1.000 | 0 | 1 | 3 | 1.000 | too few to say |
| fresh | 4 | correct-and-grounded (exploratory) | 0.500 | 0.500 | 0 | 0 | 4 | 1.000 | too few to say |
| version | 7 | correctness | 2.000 | 2.000 | 0 | 0 | 7 | 1.000 | noise |
| version | 7 | citation-accuracy | 0.857 | 0.857 | 0 | 0 | 7 | 1.000 | noise |
| version | 7 | support | 0.976 | 1.000 | 0 | 1 | 6 | 1.000 | noise |
| version | 7 | correct-and-grounded (exploratory) | 0.714 | 0.857 | 0 | 1 | 6 | 1.000 | noise |

The judge, asked twice about the same answers, gave the same grade on 45 of 45.

### Cited chunks to review as anchors

The judge found these cited chunks support a correct answer, and they are not anchors. None is added automatically (ADR-0009).

| Question | Row | Chunk | Document |
| --- | --- | --- | --- |
| ts-0001 | 2 | 3913ff930df2e0c128227533 | packages/documentation/copy/en/reference/Advanced Types.md |
| ts-0001 | 2 | bba9bb9f5227f2da821956f1 | packages/documentation/copy/en/handbook-v2/Everyday Types.md |
| ts-0001 | 3 | c91a52d277a7415b79efac2c | packages/documentation/copy/en/handbook-v2/Object Types.md |
| ts-0003 | 2 | 2393d08d7271318db87804a1 | packages/documentation/copy/en/handbook-v2/Narrowing.md |
| ts-0004 | 2 | 29e39107bb8f58e0355d156e | packages/documentation/copy/en/handbook-v2/Everyday Types.md |
| ts-0004 | 3 | 2c9764f05d9cffaa9ab871ee | packages/documentation/copy/en/release-notes/TypeScript 4.4.md |
| ts-0004 | 2 | 4c1aa60200aa5ea7a49e3308 | packages/documentation/copy/en/reference/Type Compatibility.md |
| ts-0004 | 2 | a049bb8c4f5f307c1a3015d8 | packages/documentation/copy/en/declaration-files/Do's and Don'ts.md |
| ts-0004 | 3 | b364cef04a521d7131da761a | packages/documentation/copy/en/release-notes/TypeScript 3.0.md |
| ts-0004 | 2 | e00db1895e7ae73c24a72354 | packages/documentation/copy/en/release-notes/TypeScript 4.0.md |
| ts-0007 | 2 | 34f6652f63e0340838ebab63 | packages/documentation/copy/en/handbook-v2/Object Types.md |
| ts-0008 | 2 | 27f8b210cd294fc7219a9868 | packages/documentation/copy/en/release-notes/TypeScript 3.9.md |
| ts-0008 | 2 | 3d111a972cb4950165226184 | packages/documentation/copy/en/reference/Declaration Merging.md |
| ts-0009 | 3 | 7e39a8c0e05c981e49583cfa | packages/documentation/copy/en/release-notes/TypeScript 2.8.md |
| ts-0012 | 3 | 42119b147060ab2ef5679cd0 | packages/documentation/copy/en/handbook-v2/Classes.md |
| ts-0012 | 2 | a3d542c9c7d162fbf24992a1 | packages/documentation/copy/en/release-notes/TypeScript 3.8.md |
| ts-0012 | 2 | e5994f246b6464631d7313b0 | packages/documentation/copy/en/release-notes/TypeScript 3.8.md |
| ts-0012 | 2 | ef50b87ed4efac4059bf8d5e | packages/documentation/copy/en/release-notes/TypeScript 3.8.md |
| ts-0013 | 2 | 96519721ab10de2200fcdcd5 | packages/documentation/copy/en/release-notes/TypeScript 2.8.md |
| ts-0014 | 3 | 37221569e314c5432e323635 | packages/documentation/copy/en/release-notes/TypeScript 4.9.md |
| ts-0014 | 2 | 69507a14f59b2f559c682551 | packages/documentation/copy/en/release-notes/TypeScript 3.9.md |
| ts-0015 | 2 | 63c0108f837001f61462021c | packages/documentation/copy/en/release-notes/TypeScript 5.4.md |
| ts-0020 | 2 | 43278696478040d06b9a3e9a | packages/documentation/copy/en/release-notes/TypeScript 5.0.md |
| ts-0021 | 2 | 3d7d750bce6b67a2b48a6d90 | packages/documentation/copy/en/modules-reference/Reference.md |
| ts-0021 | 3 | 617d5003d17b5ae1f3f887e8 | packages/documentation/copy/en/modules-reference/guides/Choosing Compiler Options.md |
| ts-0021 | 2 | a1a9acdb434eecc1f8c08ad2 | packages/documentation/copy/en/modules-reference/Reference.md |
| ts-0021 | 2 | bb5f2c6d372e70ffa7142919 | packages/documentation/copy/en/release-notes/TypeScript 5.0.md |
| ts-0021 | 3 | f5bffd4b08ef586d3975d449 | packages/documentation/copy/en/modules-reference/Theory.md |
| ts-0022 | 2 | f5bffd4b08ef586d3975d449 | packages/documentation/copy/en/modules-reference/Theory.md |
| ts-0023 | 2 | 475bb29f24fe609bc17c580a | packages/documentation/copy/en/release-notes/TypeScript 5.0.md |
| ts-0023 | 3 | c04a028c5b492e7d58b51f47 | packages/documentation/copy/en/handbook-v2/Modules.md |
| ts-0025 | 3 | 92081fee7a073ae57935366e | packages/documentation/copy/en/release-notes/TypeScript 3.4.md |
| ts-0025 | 2 | d00588fcd611814666b66831 | packages/documentation/copy/en/release-notes/TypeScript 5.7.md |
| ts-0028 | 3 | 318410ada364d01b89fc73ec | packages/documentation/copy/en/project-config/Compiler Options.md |
| ts-0028 | 3 | b03731b3aba8dd00c0951ccb | packages/documentation/copy/en/release-notes/TypeScript 5.9.md |
| ts-0028 | 2 | ef2f7e4c85b4cdd038c3777b | packages/documentation/copy/en/release-notes/TypeScript 4.1.md |
| ts-0030 | 3 | 26ffa08380aab95c5d48a859 | packages/documentation/copy/en/modules-reference/Theory.md |
| ts-0030 | 3 | 475bb29f24fe609bc17c580a | packages/documentation/copy/en/release-notes/TypeScript 5.0.md |
| ts-0030 | 2 | 588534de841ccd61359a211d | packages/tsconfig-reference/copy/en/options/verbatimModuleSyntax.md |
| ts-0031 | 3 | 4fed06dcecc74d802e9e79dc | packages/documentation/copy/en/release-notes/TypeScript 5.4.md |
| ts-0031 | 3 | b49836ad21eb75a5276bb018 | packages/documentation/copy/en/release-notes/TypeScript 4.5.md |
| ts-0032 | 2 | a2e4212991f3f3af2447b3e4 | packages/documentation/copy/en/release-notes/TypeScript 2.0.md |
| ts-0033 | 2 | 1ad2284b8bc3c335c9eb8292 | packages/documentation/copy/en/release-notes/TypeScript 5.0.md |
| ts-0034 | 2 | 14a0cd1a7b121d3ea025a529 | packages/documentation/copy/en/release-notes/TypeScript 5.0.md |
| ts-0035 | 2 | 33f25e6b1eaa494aba5c04bd | packages/documentation/copy/en/reference/Variable Declarations.md |
| ts-0035 | 2 | 399616a5ebde0e8af327bdf5 | packages/documentation/copy/en/release-notes/TypeScript 5.2.md |
| ts-0035 | 3 | d46fd26ef07127f355766de4 | packages/documentation/copy/en/release-notes/TypeScript 5.2.md |
| ts-0036 | 3 | ae545cfa646734042bdc4096 | packages/documentation/copy/en/project-config/Compiler Options.md |
| ts-0040 | 3 | 638128ba1a0e0abb3737cfb0 | packages/tsconfig-reference/copy/en/options/strictBindCallApply.md |
| ts-0040 | 3 | 6faee3b4563366b370fe6a08 | packages/documentation/copy/en/handbook-v2/Everyday Types.md |
| ts-0040 | 2 | 7247be0941a8f58920b1f269 | packages/tsconfig-reference/copy/en/options/checkJs.md |
| ts-0040 | 2 | d1d92b9ad7342b8d2e4f6c8f | packages/documentation/copy/en/handbook-v2/Understanding Errors.md |
