// What a difference between two sets of scores means (ADR-0010). In its own file because
// retrieval metrics and answer metrics both use it.

/**
 * What a difference means. a or b: that side is better, beyond what chance would
 * explain. noise: the sides differ by one or two questions. not-significant: by more,
 * but p >= 0.05. mixed: significant, but the side that won more questions does not
 * have the higher total, so neither is simply better. too-few: the scope has so few
 * questions that no result could be significant.
 */
export type DifferenceVerdict = 'a' | 'b' | 'noise' | 'not-significant' | 'mixed' | 'too-few'
