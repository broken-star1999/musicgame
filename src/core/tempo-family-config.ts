/** Fixed engineering parameters; support gates are not probabilities. */
export const config = Object.freeze({
    version: 'tempo-families-v1-synthetic-only', step: .01, blockSeconds: 2, windowSeconds: 8,
    pairwiseIOI: { nextOnsets: 9, minimumSeconds: .2, maximumSeconds: 3,
        histogramStep: .01, kernelSigma: .02, kernelRadiusSigma: 3, rawPeaks: 8 },
    periodHypotheses: { minimumSeconds: .27, maximumSeconds: 1.2, peakAliases: [.5, 1, 2],
        maximumRanked: 16, rawProposalMergeSeconds: .005, octaveRelativeTolerance: .03 },
    phaseHypotheses: { maximum: 4, separationSeconds: .1, minimumPredictions: 4,
        minimumPredictionSpan: 1, matchTolerance: .05, coverageGate: .42, acfGate: .06 }
} as const);
