export type D6RecognitionResult = {
  value: number | null;
  confidence: number;
  pipCount: number;
  inspectedRegion: {
    width: number;
    height: number;
  };
  notes: string[];
  debugImageUrl?: string;
};

type ConnectedComponent = {
  area: number;
  width: number;
  height: number;
  fillRatio: number;
  centerX: number;
  centerY: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DieCandidate = {
  box: Box;
  method: "bright" | "contrast" | "window" | "square" | "quad";
  score: number;
};

type CandidateSearchResult = {
  candidates: DieCandidate[];
  notes: string[];
};

const MIN_DIE_CANDIDATE_SCORE = 0.2;
const PRIMARY_DIE_PADDING_RATIO = 0.2;
const RETRY_DIE_PADDING_RATIO = 0.34;
const NORMALIZED_DIE_SIZE = 256;
const MAX_DIE_CANDIDATES = 3;

export async function recognizeD6FromDataUrl(
  imageUrl: string
): Promise<D6RecognitionResult> {
  const image = await loadImage(imageUrl);
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = image.naturalWidth;
  sourceCanvas.height = image.naturalHeight;
  const sourceContext = sourceCanvas.getContext("2d");

  if (!sourceContext) {
    return {
      value: null,
      confidence: 0,
      pipCount: 0,
      inspectedRegion: {
        width: 0,
        height: 0
      },
      notes: ["Canvas context was not available."]
    };
  }

  sourceContext.drawImage(image, 0, 0);

  const searchSize = Math.floor(Math.min(sourceCanvas.width, sourceCanvas.height) * 0.72);
  const searchX = Math.floor((sourceCanvas.width - searchSize) / 2);
  const searchY = Math.floor((sourceCanvas.height - searchSize) / 2);
  const searchImage = sourceContext.getImageData(searchX, searchY, searchSize, searchSize);
  const grayscale = createGrayscaleBuffer(searchImage);
  const candidateSearch = findLikelyDieCandidates(
    grayscale,
    searchImage.width,
    searchImage.height
  );
  const candidates = candidateSearch.candidates;
  const candidate = candidates[0] ?? null;

  if (!candidate || candidate.score < MIN_DIE_CANDIDATE_SCORE) {
    return analyzeSquareRegion(searchImage, [
      `Search crop ${searchImage.width}x${searchImage.height}`,
      candidate
        ? `${candidate.method} die candidate was too weak at score ${candidate.score.toFixed(2)}. Falling back to the broader search crop.`
        : "No likely die face was found. Falling back to the broader search crop."
    ]);
  }

  let bestResult: D6RecognitionResult | null = null;
  let bestResultScore = -Infinity;
  const candidateSummaries: string[] = [];
  let bestCandidateLabel = "";

  for (const [index, currentCandidate] of candidates.entries()) {
    if (currentCandidate.score < MIN_DIE_CANDIDATE_SCORE) {
      continue;
    }

    const candidateResult = analyzeDieCandidate(
      searchImage,
      currentCandidate,
      index,
      candidates.length
    );
    const resultScore = scoreRecognizedCandidate(candidateResult, currentCandidate.score);
    const candidateLabel = `${currentCandidate.method} candidate ${index + 1}/${candidates.length}`;
    candidateSummaries.push(
      `${candidateLabel} score ${resultScore.toFixed(2)} from die ${currentCandidate.score.toFixed(2)}, confidence ${candidateResult.confidence.toFixed(2)}, pips ${candidateResult.pipCount}, value ${candidateResult.value ?? "none"}`
    );

    if (resultScore > bestResultScore) {
      bestResult = candidateResult;
      bestResultScore = resultScore;
      bestCandidateLabel = candidateLabel;
    }
  }

  if (bestResult) {
    return {
      ...bestResult,
      notes: [
      ...bestResult.notes,
        ...candidateSearch.notes,
        ...candidateSummaries,
        `Chose ${bestCandidateLabel} with combined score ${bestResultScore.toFixed(2)}`
      ]
    };
  }

  return analyzeSquareRegion(searchImage, [
    `Search crop ${searchImage.width}x${searchImage.height}`,
    ...candidateSearch.notes,
    "Candidate analysis produced no usable die crop. Falling back to the broader search crop."
  ]);
}

function analyzeSquareRegion(
  imageData: ImageData,
  notesPrefix: string[]
): D6RecognitionResult {
  const normalizedImage = normalizeImageData(imageData, NORMALIZED_DIE_SIZE);
  const { width, height } = normalizedImage;
  const grayscale = createGrayscaleBuffer(normalizedImage);
  const pixelCount = width * height;
  let sum = 0;

  for (let index = 0; index < pixelCount; index += 1) {
    sum += grayscale[index];
  }

  const meanBrightness = sum / pixelCount;
  const threshold = Math.max(24, Math.min(170, meanBrightness * 0.68));
  const darkMask = createAdaptiveDarkMask(grayscale, width, height, meanBrightness);

  const components = findConnectedComponents(darkMask, width, height);
  const regionArea = width * height;
  const minArea = Math.max(8, regionArea * 0.0016);
  const maxArea = regionArea * 0.11;
  const candidatePips = components.filter((component) => {
    const aspectRatio = component.width / component.height;
    const localContrastScore = scoreLocalPipContrast(grayscale, width, height, component);
    const nearEdge =
      component.centerX < width * 0.08 ||
      component.centerX > width * 0.92 ||
      component.centerY < height * 0.08 ||
      component.centerY > height * 0.92;

    return (
      component.area >= minArea &&
      component.area <= maxArea &&
      aspectRatio > 0.5 &&
      aspectRatio < 1.7 &&
      component.fillRatio > 0.3 &&
      component.fillRatio < 0.92 &&
      component.centerX > width * 0.03 &&
      component.centerX < width * 0.97 &&
      component.centerY > height * 0.03 &&
      component.centerY < height * 0.97 &&
      localContrastScore >= (nearEdge ? 0.12 : 0.18)
    );
  });

  const groupedPips = mergeNearbyPips(
    candidatePips,
    Math.max(width, height) * 0.11
  );
  const preservedFourCorners = findBestFourCornerSubset(groupedPips, width, height);
  const exactFourPassThrough =
    candidatePips.length === 4 && groupedPips.length === 4;
  const exactFivePassThrough =
    candidatePips.length === 5 && groupedPips.length === 5;
  const trustGroupedFourPips =
    exactFourPassThrough ||
    (groupedPips.length === 4 && scoreD6Layout(groupedPips, width, height) >= 0.44);
  const trustGroupedFivePips =
    exactFivePassThrough ||
    (groupedPips.length === 5 && scoreD6Layout(groupedPips, width, height) >= 0.42);
  const basePips =
    preservedFourCorners ??
    ((trustGroupedFourPips || trustGroupedFivePips)
      ? groupedPips
      : groupedPips.length >= 1 &&
    groupedPips.length <= 4 &&
    consistencyScore(groupedPips) > 0.42
      ? groupedPips
      : selectLikelyPips(groupedPips, width, height));
  const scoredPips = trustGroupedFourPips || trustGroupedFivePips
    ? groupedPips
    : applyLayoutSanity(basePips, width, height);
  const mergedPipCount = scoredPips.length;
  const value = mergedPipCount >= 1 && mergedPipCount <= 6 ? mergedPipCount : null;
  const componentQuality =
    scoredPips.length === 0
      ? 0
      : scoredPips.reduce((score, component) => {
          const aspectPenalty = Math.abs(1 - component.width / component.height);
          const fillPenalty = Math.abs(0.62 - component.fillRatio);
          return score + Math.max(0, 1 - aspectPenalty - fillPenalty);
        }, 0) / scoredPips.length;
  const countConfidence = value ? 1 - Math.abs(3.5 - value) / 6 : 0.18;
  const confidence = Number(
    Math.max(
      0,
      Math.min(
        0.98,
        componentQuality * 0.5 +
          countConfidence * 0.25 +
          edgePenalty(width, height, scoredPips) * 0.15 +
          consistencyScore(scoredPips) * 0.1
      )
    ).toFixed(2)
  );

  const notes = [
    ...notesPrefix,
    `Normalized crop to ${width}x${height}`,
    `Adaptive threshold baseline ${Math.round(threshold)} from mean brightness ${Math.round(meanBrightness)}`,
    `${components.length} dark components, ${candidatePips.length} pip candidates, ${groupedPips.length} merged groups, ${basePips.length} selected pips, ${mergedPipCount} layout-checked pips`,
    preservedFourCorners
      ? "Branch: preserved four-corner subset"
      : exactFourPassThrough
        ? "Branch: exact four-candidate pass-through"
      : exactFivePassThrough
        ? "Branch: exact five-candidate pass-through"
      : trustGroupedFourPips
        ? "Branch: trusted grouped four pips directly"
      : trustGroupedFivePips
        ? "Branch: trusted grouped five pips directly"
        : "Branch: standard selection/layout flow"
  ];

  if (value === null) {
    notes.push("Pip count fell outside the expected d6 range.");
  }

  return {
    value,
    confidence,
    pipCount: mergedPipCount,
    inspectedRegion: {
      width: imageData.width,
      height: imageData.height
    },
    notes,
    debugImageUrl: renderDebugImage(
      normalizedImage,
      candidatePips,
      groupedPips,
      basePips,
      scoredPips,
      threshold
    )
  };
}

function renderDebugImage(
  imageData: ImageData,
  candidatePips: ConnectedComponent[],
  groupedPips: ConnectedComponent[],
  basePips: ConnectedComponent[],
  finalPips: ConnectedComponent[],
  threshold: number
): string | undefined {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext("2d");

  if (!context) {
    return undefined;
  }

  context.putImageData(imageData, 0, 0);
  context.fillStyle = "rgba(0, 0, 0, 0.18)";
  context.fillRect(0, 0, canvas.width, 26);
  context.fillStyle = "#f5f0e8";
  context.font = "12px Segoe UI";
  context.fillText(`thr ${Math.round(threshold)} | cand ${candidatePips.length} | merged ${groupedPips.length} | final ${finalPips.length}`, 8, 17);

  drawComponents(context, candidatePips, "rgba(255, 184, 108, 0.95)", 1.5);
  drawComponents(context, groupedPips, "rgba(123, 211, 137, 0.95)", 2);
  drawComponents(context, basePips, "rgba(83, 174, 255, 0.95)", 2);
  drawComponents(context, finalPips, "rgba(255, 94, 125, 0.95)", 3);

  return canvas.toDataURL("image/png");
}

function drawComponents(
  context: CanvasRenderingContext2D,
  components: ConnectedComponent[],
  strokeStyle: string,
  lineWidth: number
) {
  context.strokeStyle = strokeStyle;
  context.fillStyle = strokeStyle;
  context.lineWidth = lineWidth;

  for (const component of components) {
    context.strokeRect(
      component.minX - 1,
      component.minY - 1,
      component.width + 2,
      component.height + 2
    );
    context.beginPath();
    context.arc(component.centerX, component.centerY, 3, 0, Math.PI * 2);
    context.fill();
  }
}

function selectLikelyPips(
  components: ConnectedComponent[],
  width: number,
  height: number
): ConnectedComponent[] {
  if (components.length <= 1) {
    return components;
  }

  const sortedAreas = [...components].map((component) => component.area).sort((left, right) => left - right);
  const medianArea = sortedAreas[Math.floor(sortedAreas.length / 2)];
  const centerX = width / 2;
  const centerY = height / 2;

  const scored = components
    .map((component) => {
      const areaRatio = component.area / Math.max(medianArea, 1);
      const areaScore = 1 - Math.min(Math.abs(1 - areaRatio), 1);
      const centerDistance =
        Math.hypot(component.centerX - centerX, component.centerY - centerY) /
        Math.hypot(centerX, centerY);
      const centerScore = 1 - Math.min(centerDistance, 1);
      const aspectScore = 1 - Math.min(Math.abs(1 - component.width / component.height), 1);
      const fillScore = 1 - Math.min(Math.abs(0.62 - component.fillRatio), 1);

      return {
        component,
        score: areaScore * 0.35 + centerScore * 0.2 + aspectScore * 0.2 + fillScore * 0.25,
        areaRatio
      };
    })
    .sort((left, right) => right.score - left.score);

  const filtered = scored.filter((entry) => {
    if (components.length <= 2) {
      return entry.areaRatio > 0.38;
    }

    return entry.areaRatio > 0.48;
  });

  const selected = (filtered.length > 0 ? filtered : scored)
    .slice(0, Math.min(6, components.length))
    .map((entry) => entry.component)
    .sort((left, right) => left.centerY - right.centerY || left.centerX - right.centerX);

  return selected;
}

function applyLayoutSanity(
  components: ConnectedComponent[],
  width: number,
  height: number
): ConnectedComponent[] {
  if (components.length <= 1) {
    return components;
  }

  let bestSet = components;
  let bestScore = scoreD6Layout(components, width, height);

  if (components.length === 4 && looksLikeFourCorners(components, width, height)) {
    return components;
  }

  if (components.length >= 3) {
    const requiredImprovement =
      components.length >= 6 ? 0.28 : components.length >= 4 ? 0.2 : 0.12;

    for (let index = 0; index < components.length; index += 1) {
      const subset = components.filter((_, candidateIndex) => candidateIndex !== index);
      const subsetScore = scoreD6Layout(subset, width, height);

      if (subsetScore > bestScore + requiredImprovement) {
        bestSet = subset;
        bestScore = subsetScore;
      }
    }
  }

  return bestSet;
}

function scoreD6Layout(
  components: ConnectedComponent[],
  width: number,
  height: number
): number {
  if (components.length === 0) {
    return 0;
  }

  const normalized = components.map((component) => ({
    x: component.centerX / width,
    y: component.centerY / height
  }));

  const expectedPatterns: Record<number, Array<{ x: number; y: number }>> = {
    1: [{ x: 0.5, y: 0.5 }],
    2: [
      { x: 0.28, y: 0.28 },
      { x: 0.72, y: 0.72 }
    ],
    3: [
      { x: 0.28, y: 0.28 },
      { x: 0.5, y: 0.5 },
      { x: 0.72, y: 0.72 }
    ],
    4: [
      { x: 0.28, y: 0.28 },
      { x: 0.72, y: 0.28 },
      { x: 0.28, y: 0.72 },
      { x: 0.72, y: 0.72 }
    ],
    5: [
      { x: 0.28, y: 0.28 },
      { x: 0.72, y: 0.28 },
      { x: 0.5, y: 0.5 },
      { x: 0.28, y: 0.72 },
      { x: 0.72, y: 0.72 }
    ],
    6: [
      { x: 0.28, y: 0.22 },
      { x: 0.72, y: 0.22 },
      { x: 0.28, y: 0.5 },
      { x: 0.72, y: 0.5 },
      { x: 0.28, y: 0.78 },
      { x: 0.72, y: 0.78 }
    ]
  };

  const pattern = expectedPatterns[components.length];

  if (!pattern) {
    return 0;
  }

  const usedPatternIndexes = new Set<number>();
  let totalDistance = 0;

  for (const pip of normalized) {
    let bestDistance = Infinity;
    let bestPatternIndex = -1;

    for (let index = 0; index < pattern.length; index += 1) {
      if (usedPatternIndexes.has(index)) {
        continue;
      }

      const distance = Math.hypot(pip.x - pattern[index].x, pip.y - pattern[index].y);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestPatternIndex = index;
      }
    }

    if (bestPatternIndex >= 0) {
      usedPatternIndexes.add(bestPatternIndex);
      totalDistance += bestDistance;
    }
  }

  const meanDistance = totalDistance / components.length;
  return Math.max(0, 1 - meanDistance / 0.34) * 0.75 + consistencyScore(components) * 0.25;
}

function looksLikeFourCorners(
  components: ConnectedComponent[],
  width: number,
  height: number
): boolean {
  if (components.length !== 4) {
    return false;
  }

  const normalized = components.map((component) => ({
    x: component.centerX / width,
    y: component.centerY / height
  }));
  const left = normalized.filter((component) => component.x < 0.5).length;
  const right = normalized.filter((component) => component.x >= 0.5).length;
  const top = normalized.filter((component) => component.y < 0.5).length;
  const bottom = normalized.filter((component) => component.y >= 0.5).length;

  if (left !== 2 || right !== 2 || top !== 2 || bottom !== 2) {
    return false;
  }

  return scoreD6Layout(components, width, height) >= 0.52;
}

function findBestFourCornerSubset(
  components: ConnectedComponent[],
  width: number,
  height: number
): ConnectedComponent[] | null {
  if (components.length < 4) {
    return null;
  }

  const candidatePool = [...components]
    .sort((left, right) => right.area - left.area)
    .slice(0, Math.min(6, components.length));
  let bestSubset: ConnectedComponent[] | null = null;
  let bestScore = -Infinity;

  for (let first = 0; first < candidatePool.length - 3; first += 1) {
    for (let second = first + 1; second < candidatePool.length - 2; second += 1) {
      for (let third = second + 1; third < candidatePool.length - 1; third += 1) {
        for (let fourth = third + 1; fourth < candidatePool.length; fourth += 1) {
          const subset = [
            candidatePool[first],
            candidatePool[second],
            candidatePool[third],
            candidatePool[fourth]
          ];

          if (!looksLikeFourCorners(subset, width, height)) {
            continue;
          }

          const score =
            scoreD6Layout(subset, width, height) * 0.7 +
            consistencyScore(subset) * 0.3;

          if (score > bestScore) {
            bestSubset = subset;
            bestScore = score;
          }
        }
      }
    }
  }

  return bestSubset;
}

function findLikelyDieCandidates(
  grayscale: Uint8Array,
  width: number,
  height: number
): CandidateSearchResult {
  const quadCandidates = findQuadDieCandidates(grayscale, width, height);
  const squareCandidates = findSquareDieCandidates(grayscale, width, height);
  const brightCandidates = findBrightDieCandidates(grayscale, width, height);
  const contrastCandidates = findContrastDieCandidates(grayscale, width, height);
  const windowCandidates = findWindowDieCandidates(grayscale, width, height);
  const allCandidates = [
    ...quadCandidates,
    ...squareCandidates,
    ...brightCandidates,
    ...contrastCandidates,
    ...windowCandidates
  ];
  const shortlist = dedupeAndRankCandidates(allCandidates);
  const bestQuadCandidate = quadCandidates[0];

  if (
    bestQuadCandidate &&
    !shortlist.some((candidate) => candidate.method === "quad")
  ) {
    const withoutLast = shortlist.slice(0, Math.max(0, MAX_DIE_CANDIDATES - 1));
    shortlist.length = 0;
    shortlist.push(
      ...dedupeAndRankCandidates([...withoutLast, bestQuadCandidate]).slice(0, MAX_DIE_CANDIDATES)
    );
  }

  const notes = [
    `Candidate pools: quad ${quadCandidates.length}${bestQuadCandidate ? ` top ${bestQuadCandidate.score.toFixed(2)}` : ""}, square ${squareCandidates.length}, bright ${brightCandidates.length}, contrast ${contrastCandidates.length}, window ${windowCandidates.length}`
  ];

  if (bestQuadCandidate) {
    notes.push(
      shortlist.some((candidate) => candidate.method === "quad")
        ? `Included quad candidate with score ${bestQuadCandidate.score.toFixed(2)} in shortlist`
        : `Quad candidate score ${bestQuadCandidate.score.toFixed(2)} did not survive shortlist`
    );
  }

  return {
    candidates: shortlist,
    notes
  };
}

function findBrightDieCandidates(
  grayscale: Uint8Array,
  width: number,
  height: number
): DieCandidate[] {
  const pixelCount = width * height;
  let sum = 0;

  for (let index = 0; index < pixelCount; index += 1) {
    sum += grayscale[index];
  }

  const meanBrightness = sum / pixelCount;
  const brightThreshold = Math.max(112, Math.min(220, meanBrightness * 1.04));
  const brightMask = new Uint8Array(pixelCount);

  for (let index = 0; index < pixelCount; index += 1) {
    brightMask[index] = grayscale[index] >= brightThreshold ? 1 : 0;
  }

  const components = findConnectedComponents(brightMask, width, height);
  return scoreCandidateComponents(components, width, height, "bright", grayscale);
}

function findSquareDieCandidates(
  grayscale: Uint8Array,
  width: number,
  height: number
): DieCandidate[] {
  const minSide = Math.max(44, Math.round(Math.min(width, height) * 0.18));
  const maxSide = Math.max(minSide, Math.round(Math.min(width, height) * 0.56));
  const sideSteps = 5;
  const xOffsets = [-0.28, -0.14, 0, 0.14, 0.28];
  const yOffsets = [-0.28, -0.14, 0, 0.14, 0.28];
  const centerX = width / 2;
  const centerY = height / 2;
  const candidates: DieCandidate[] = [];

  for (let step = 0; step < sideSteps; step += 1) {
    const ratio = step / (sideSteps - 1);
    const side = Math.round(minSide + (maxSide - minSide) * ratio);

    for (const xOffset of xOffsets) {
      for (const yOffset of yOffsets) {
        const box = clampBox(
          {
            x: Math.round(centerX - side / 2 + width * xOffset),
            y: Math.round(centerY - side / 2 + height * yOffset),
            width: side,
            height: side
          },
          width,
          height
        );
        const score = scoreSquareCandidate(grayscale, width, height, box);

        if (score >= 0.3) {
          candidates.push({
            method: "square",
            box,
            score
          });
        }
      }
    }
  }

  return candidates.sort((left, right) => right.score - left.score).slice(0, MAX_DIE_CANDIDATES * 2);
}

function findQuadDieCandidates(
  grayscale: Uint8Array,
  width: number,
  height: number
): DieCandidate[] {
  const edgeMap = createEdgeStrengthMap(grayscale, width, height);
  const pixelCount = width * height;
  let edgeSum = 0;

  for (let index = 0; index < pixelCount; index += 1) {
    edgeSum += edgeMap[index];
  }

  const meanEdge = edgeSum / Math.max(pixelCount, 1);
  const edgeThreshold = Math.max(26, Math.min(88, meanEdge * 1.55));
  const edgeMask = new Uint8Array(pixelCount);

  for (let index = 0; index < pixelCount; index += 1) {
    edgeMask[index] = edgeMap[index] >= edgeThreshold ? 1 : 0;
  }

  const components = findConnectedComponents(edgeMask, width, height);
  const regionArea = width * height;
  const candidates: DieCandidate[] = [];

  for (const component of components) {
    const boxArea = component.width * component.height;

    if (boxArea < regionArea * 0.025 || boxArea > regionArea * 0.62) {
      continue;
    }

    const aspectRatio = component.width / Math.max(component.height, 1);

    if (aspectRatio < 0.7 || aspectRatio > 1.35) {
      continue;
    }

    const box = expandBoxToSquare(
      {
        x: component.minX,
        y: component.minY,
        width: component.width,
        height: component.height
      },
      width,
      height,
      0.08
    );
    const score = scoreQuadCandidate(grayscale, width, height, box, component.fillRatio);

    if (score >= 0.24) {
      candidates.push({
        method: "quad",
        box,
        score
      });
    }
  }

  return candidates.sort((left, right) => right.score - left.score).slice(0, MAX_DIE_CANDIDATES * 2);
}

function findContrastDieCandidates(
  grayscale: Uint8Array,
  width: number,
  height: number
): DieCandidate[] {
  const windowSize = Math.max(8, Math.round(Math.min(width, height) * 0.08));
  const contrastMask = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const minX = Math.max(0, x - windowSize);
      const maxX = Math.min(width - 1, x + windowSize);
      const minY = Math.max(0, y - windowSize);
      const maxY = Math.min(height - 1, y + windowSize);

      let localMin = 255;
      let localMax = 0;

      for (let sampleY = minY; sampleY <= maxY; sampleY += windowSize) {
        for (let sampleX = minX; sampleX <= maxX; sampleX += windowSize) {
          const value = grayscale[sampleY * width + sampleX];
          localMin = Math.min(localMin, value);
          localMax = Math.max(localMax, value);
        }
      }

      contrastMask[y * width + x] = localMax - localMin > 52 ? 1 : 0;
    }
  }

  const components = findConnectedComponents(contrastMask, width, height);
  return scoreCandidateComponents(components, width, height, "contrast", grayscale);
}

function scoreCandidateComponents(
  components: ConnectedComponent[],
  width: number,
  height: number,
  method: "bright" | "contrast",
  grayscale: Uint8Array
): DieCandidate[] {
  const centerX = width / 2;
  const centerY = height / 2;
  const regionArea = width * height;
  const scoredCandidates: DieCandidate[] = [];

  for (const component of components) {
    const componentArea = component.width * component.height;

    if (componentArea < regionArea * 0.03 || componentArea > regionArea * 0.6) {
      continue;
    }

    const aspectRatio = component.width / component.height;

    if (aspectRatio < 0.62 || aspectRatio > 1.5) {
      continue;
    }

    const edgeMarginX = width * 0.05;
    const edgeMarginY = height * 0.05;

    if (
      component.minX <= edgeMarginX ||
      component.minY <= edgeMarginY ||
      component.maxX >= width - edgeMarginX ||
      component.maxY >= height - edgeMarginY
    ) {
      continue;
    }

    if (component.fillRatio > 0.94) {
      continue;
    }

    const centerDistance =
      Math.hypot(component.centerX - centerX, component.centerY - centerY) /
      Math.hypot(centerX, centerY);
    const interiorBrightness = scoreCandidateInteriorBrightness(
      grayscale,
      width,
      height,
      component
    );
    const fillBonus = component.fillRatio;
    const sizeBonus = Math.min(componentArea / (regionArea * 0.18), 1.4);
    const methodBonus = method === "bright" ? 0.08 : 0;
    const score =
      sizeBonus * 1.4 +
      fillBonus * 0.9 +
      interiorBrightness * 0.95 +
      methodBonus -
      Math.abs(1 - aspectRatio) * 1.05 -
      centerDistance * 1.45;

    scoredCandidates.push({
      method,
      score,
      box: {
        x: component.minX,
        y: component.minY,
        width: component.width,
        height: component.height
      }
    });
  }

  return scoredCandidates.sort((left, right) => right.score - left.score).slice(0, MAX_DIE_CANDIDATES);
}

function findWindowDieCandidates(
  grayscale: Uint8Array,
  width: number,
  height: number
): DieCandidate[] {
  const side = Math.max(36, Math.round(Math.min(width, height) * 0.34));
  const xOffsets = [-0.18, 0, 0.18];
  const yOffsets = [-0.18, 0, 0.18];
  const centerX = width / 2;
  const centerY = height / 2;
  const candidates: DieCandidate[] = [];

  for (const xOffset of xOffsets) {
    for (const yOffset of yOffsets) {
      const box = clampBox({
        x: Math.round(centerX - side / 2 + width * xOffset),
        y: Math.round(centerY - side / 2 + height * yOffset),
        width: side,
        height: side
      }, width, height);
      const score = scoreWindowCandidate(grayscale, width, height, box);

      candidates.push({
        method: "window",
        box,
        score
      });
    }
  }

  return candidates
    .filter((candidate) => candidate.score >= 0.24)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_DIE_CANDIDATES);
}

function scoreWindowCandidate(
  grayscale: Uint8Array,
  width: number,
  height: number,
  box: Box
): number {
  let localMin = 255;
  let localMax = 0;
  let sum = 0;
  let count = 0;

  for (let y = box.y; y < box.y + box.height; y += 1) {
    for (let x = box.x; x < box.x + box.width; x += 1) {
      const value = grayscale[y * width + x];
      localMin = Math.min(localMin, value);
      localMax = Math.max(localMax, value);
      sum += value;
      count += 1;
    }
  }

  const mean = sum / count;
  const threshold = Math.max(22, Math.min(170, mean * 0.7));
  let darkCount = 0;

  for (let y = box.y; y < box.y + box.height; y += 1) {
    for (let x = box.x; x < box.x + box.width; x += 1) {
      if (grayscale[y * width + x] < threshold) {
        darkCount += 1;
      }
    }
  }

  const contrastScore = Math.min((localMax - localMin) / 120, 1);
  const darkRatio = darkCount / count;
  const darkRatioScore = 1 - Math.min(Math.abs(0.16 - darkRatio) / 0.16, 1);

  return contrastScore * 0.6 + darkRatioScore * 0.4;
}

function scoreSquareCandidate(
  grayscale: Uint8Array,
  width: number,
  height: number,
  box: Box
): number {
  const edgeMap = createEdgeStrengthMap(grayscale, width, height);
  const ringThickness = Math.max(3, Math.round(box.width * 0.08));
  let borderEdgeSum = 0;
  let borderCount = 0;
  let interiorEdgeSum = 0;
  let interiorCount = 0;
  let interiorBrightnessSum = 0;
  let interiorBrightnessCount = 0;

  for (let y = box.y; y < box.y + box.height; y += 1) {
    for (let x = box.x; x < box.x + box.width; x += 1) {
      const distanceToEdge = Math.min(
        x - box.x,
        box.x + box.width - 1 - x,
        y - box.y,
        box.y + box.height - 1 - y
      );
      const edgeValue = edgeMap[y * width + x];

      if (distanceToEdge <= ringThickness) {
        borderEdgeSum += edgeValue;
        borderCount += 1;
      } else {
        interiorEdgeSum += edgeValue;
        interiorCount += 1;
        interiorBrightnessSum += grayscale[y * width + x];
        interiorBrightnessCount += 1;
      }
    }
  }

  if (borderCount === 0 || interiorCount === 0 || interiorBrightnessCount === 0) {
    return 0;
  }

  const borderEdgeMean = borderEdgeSum / borderCount;
  const interiorEdgeMean = interiorEdgeSum / interiorCount;
  const interiorBrightnessMean = interiorBrightnessSum / interiorBrightnessCount;
  const edgeContrast = Math.max(0, borderEdgeMean - interiorEdgeMean);
  const edgeScore = Math.min(edgeContrast / 34, 1);
  const interiorBrightnessScore = Math.max(0, Math.min(1, (interiorBrightnessMean - 92) / 120));
  const sizeRatio = (box.width * box.height) / Math.max(width * height, 1);
  const sizeScore = 1 - Math.min(Math.abs(0.18 - sizeRatio) / 0.18, 1);
  const centerDistance =
    Math.hypot(box.x + box.width / 2 - width / 2, box.y + box.height / 2 - height / 2) /
    Math.hypot(width / 2, height / 2);
  const centerScore = 1 - Math.min(centerDistance, 1);

  return edgeScore * 0.42 + interiorBrightnessScore * 0.24 + sizeScore * 0.18 + centerScore * 0.16;
}

function scoreQuadCandidate(
  grayscale: Uint8Array,
  width: number,
  height: number,
  box: Box,
  edgeFillRatio: number
): number {
  const squareScore = scoreSquareCandidate(grayscale, width, height, box);
  const edgeFillScore = 1 - Math.min(Math.abs(0.18 - edgeFillRatio) / 0.18, 1);
  const interiorBrightnessScore = scoreBoxInteriorBrightness(grayscale, width, height, box);

  return squareScore * 0.62 + edgeFillScore * 0.18 + interiorBrightnessScore * 0.2;
}

function scoreBoxInteriorBrightness(
  grayscale: Uint8Array,
  width: number,
  height: number,
  box: Box
): number {
  const insetX = Math.max(2, Math.floor(box.width * 0.16));
  const insetY = Math.max(2, Math.floor(box.height * 0.16));
  const minX = Math.max(0, box.x + insetX);
  const maxX = Math.min(width - 1, box.x + box.width - 1 - insetX);
  const minY = Math.max(0, box.y + insetY);
  const maxY = Math.min(height - 1, box.y + box.height - 1 - insetY);

  if (minX > maxX || minY > maxY) {
    return 0;
  }

  let sum = 0;
  let count = 0;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      sum += grayscale[y * width + x];
      count += 1;
    }
  }

  if (count === 0) {
    return 0;
  }

  const meanBrightness = sum / count;
  return Math.max(0, Math.min(1, (meanBrightness - 90) / 120));
}

function createEdgeStrengthMap(
  grayscale: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const edgeMap = new Uint8Array(width * height);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const gx =
        grayscale[index + 1] -
        grayscale[index - 1] +
        grayscale[index - width + 1] -
        grayscale[index - width - 1] +
        grayscale[index + width + 1] -
        grayscale[index + width - 1];
      const gy =
        grayscale[index + width] -
        grayscale[index - width] +
        grayscale[index + width - 1] -
        grayscale[index - width - 1] +
        grayscale[index + width + 1] -
        grayscale[index - width + 1];
      edgeMap[index] = Math.min(255, Math.round(Math.hypot(gx, gy) / 3));
    }
  }

  return edgeMap;
}

function expandBoxToSquare(
  box: Box,
  maxWidth: number,
  maxHeight: number,
  paddingRatio: number
): Box {
  const side = Math.round(Math.max(box.width, box.height) * (1 + paddingRatio * 2));
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  return clampBox(
    {
      x: Math.round(centerX - side / 2),
      y: Math.round(centerY - side / 2),
      width: side,
      height: side
    },
    maxWidth,
    maxHeight
  );
}

function dedupeAndRankCandidates(candidates: DieCandidate[]): DieCandidate[] {
  const ranked = [...candidates].sort((left, right) => right.score - left.score);
  const deduped: DieCandidate[] = [];

  for (const candidate of ranked) {
    const overlapsExisting = deduped.some((existing) => {
      return boxesOverlapByRatio(existing.box, candidate.box) > 0.72;
    });

    if (!overlapsExisting) {
      deduped.push(candidate);
    }

    if (deduped.length >= MAX_DIE_CANDIDATES) {
      break;
    }
  }

  return deduped;
}

function boxesOverlapByRatio(left: Box, right: Box): number {
  const overlapWidth =
    Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const overlapHeight =
    Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  const overlapArea = overlapWidth * overlapHeight;

  if (overlapArea === 0) {
    return 0;
  }

  const leftArea = left.width * left.height;
  const rightArea = right.width * right.height;

  return overlapArea / Math.max(Math.min(leftArea, rightArea), 1);
}

function analyzeDieCandidate(
  searchImage: ImageData,
  candidate: DieCandidate,
  candidateIndex: number,
  candidateCount: number
): D6RecognitionResult {
  const paddedBox = padBox(
    candidate.box,
    searchImage.width,
    searchImage.height,
    PRIMARY_DIE_PADDING_RATIO
  );
  const dieImage = cropImageData(searchImage, paddedBox);
  const primaryNotes = [
    `Search crop ${searchImage.width}x${searchImage.height}`,
    `${candidate.method} die candidate ${candidateIndex + 1}/${candidateCount} ${Math.round(paddedBox.width)}x${Math.round(paddedBox.height)} at ${Math.round(paddedBox.x)},${Math.round(paddedBox.y)} score ${candidate.score.toFixed(2)}`
  ];
  const primaryResult = analyzeSquareRegion(dieImage, primaryNotes);

  if (
    shouldRetryCropAnalysis(
      primaryResult,
      candidate.box,
      paddedBox,
      searchImage.width,
      searchImage.height
    )
  ) {
    const retryBox = buildRetryCropBox(candidate.box, searchImage.width, searchImage.height);

    if (!boxesMatch(paddedBox, retryBox)) {
      const retryResult = analyzeSquareRegion(cropImageData(searchImage, retryBox), [
        `Search crop ${searchImage.width}x${searchImage.height}`,
        `${candidate.method} die retry ${candidateIndex + 1}/${candidateCount} ${Math.round(retryBox.width)}x${Math.round(retryBox.height)} at ${Math.round(retryBox.x)},${Math.round(retryBox.y)} after weak primary crop`
      ]);

      if (isRetryResultBetter(primaryResult, retryResult)) {
        return retryResult;
      }
    }
  }

  return primaryResult;
}

function scoreRecognizedCandidate(
  result: D6RecognitionResult,
  candidateScore: number
): number {
  const valueScore = result.value === null ? 0 : 0.35;
  const pipRangeScore =
    result.pipCount >= 1 && result.pipCount <= 6
      ? 0.18
      : result.pipCount > 0
        ? 0.06
        : 0;
  const noteText = result.notes.join(" ").toLowerCase();
  const retryBonus = noteText.includes("die retry") ? 0.08 : 0;
  const candidateEvidenceBonus =
    noteText.includes("pip candidates, 0") ? 0 : Math.min(result.pipCount, 6) * 0.05;
  const edgePenaltyBonus = result.confidence >= 0.55 ? 0.08 : 0;

  return (
    valueScore +
    pipRangeScore +
    result.confidence * 1.05 +
    candidateEvidenceBonus +
    retryBonus +
    edgePenaltyBonus +
    candidateScore * 0.12
  );
}

function shouldRetryCropAnalysis(
  result: D6RecognitionResult,
  candidateBox: Box,
  paddedBox: Box,
  searchWidth: number,
  searchHeight: number
): boolean {
  if (result.value === null || result.pipCount === 0) {
    return true;
  }

  const centerX = searchWidth / 2;
  const centerY = searchHeight / 2;
  const candidateCenterDistance =
    Math.hypot(
      candidateBox.x + candidateBox.width / 2 - centerX,
      candidateBox.y + candidateBox.height / 2 - centerY
    ) / Math.hypot(centerX, centerY);
  const touchesEdge =
    paddedBox.x <= 0 ||
    paddedBox.y <= 0 ||
    paddedBox.x + paddedBox.width >= searchWidth ||
    paddedBox.y + paddedBox.height >= searchHeight;

  return candidateCenterDistance > 0.22 || touchesEdge;
}

function buildRetryCropBox(
  candidateBox: Box,
  searchWidth: number,
  searchHeight: number
): Box {
  const centerX = candidateBox.x + candidateBox.width / 2;
  const centerY = candidateBox.y + candidateBox.height / 2;
  const side = Math.min(
    Math.max(
      Math.round(Math.max(candidateBox.width, candidateBox.height) * (1 + RETRY_DIE_PADDING_RATIO * 2)),
      Math.round(Math.min(searchWidth, searchHeight) * 0.42)
    ),
    Math.min(searchWidth, searchHeight)
  );

  return clampBox(
    {
      x: Math.round(centerX - side / 2),
      y: Math.round(centerY - side / 2),
      width: side,
      height: side
    },
    searchWidth,
    searchHeight
  );
}

function boxesMatch(left: Box, right: Box): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function isRetryResultBetter(
  primaryResult: D6RecognitionResult,
  retryResult: D6RecognitionResult
): boolean {
  if (primaryResult.value === null && retryResult.value !== null) {
    return true;
  }

  if (primaryResult.pipCount === 0 && retryResult.pipCount > 0) {
    return true;
  }

  if (retryResult.value !== null && primaryResult.value !== null) {
    return retryResult.confidence > primaryResult.confidence + 0.08;
  }

  return retryResult.pipCount > primaryResult.pipCount && retryResult.confidence >= primaryResult.confidence;
}

function scoreCandidateInteriorBrightness(
  grayscale: Uint8Array,
  width: number,
  height: number,
  component: ConnectedComponent
): number {
  const insetX = Math.max(1, Math.floor(component.width * 0.14));
  const insetY = Math.max(1, Math.floor(component.height * 0.14));
  const minX = Math.max(0, component.minX + insetX);
  const maxX = Math.min(width - 1, component.maxX - insetX);
  const minY = Math.max(0, component.minY + insetY);
  const maxY = Math.min(height - 1, component.maxY - insetY);

  if (minX > maxX || minY > maxY) {
    return 0;
  }

  let sum = 0;
  let count = 0;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      sum += grayscale[y * width + x];
      count += 1;
    }
  }

  if (count === 0) {
    return 0;
  }

  const meanBrightness = sum / count;
  return Math.max(0, Math.min(1, (meanBrightness - 90) / 120));
}

function scoreLocalPipContrast(
  grayscale: Uint8Array,
  width: number,
  height: number,
  component: ConnectedComponent
): number {
  let componentSum = 0;
  let componentCount = 0;

  for (let y = component.minY; y <= component.maxY; y += 1) {
    for (let x = component.minX; x <= component.maxX; x += 1) {
      componentSum += grayscale[y * width + x];
      componentCount += 1;
    }
  }

  const ringPaddingX = Math.max(3, Math.floor(component.width * 0.9));
  const ringPaddingY = Math.max(3, Math.floor(component.height * 0.9));
  const outerMinX = Math.max(0, component.minX - ringPaddingX);
  const outerMaxX = Math.min(width - 1, component.maxX + ringPaddingX);
  const outerMinY = Math.max(0, component.minY - ringPaddingY);
  const outerMaxY = Math.min(height - 1, component.maxY + ringPaddingY);

  let ringSum = 0;
  let ringCount = 0;

  for (let y = outerMinY; y <= outerMaxY; y += 1) {
    for (let x = outerMinX; x <= outerMaxX; x += 1) {
      const insideComponent =
        x >= component.minX &&
        x <= component.maxX &&
        y >= component.minY &&
        y <= component.maxY;

      if (insideComponent) {
        continue;
      }

      ringSum += grayscale[y * width + x];
      ringCount += 1;
    }
  }

  if (componentCount === 0 || ringCount === 0) {
    return 0;
  }

  const componentMean = componentSum / componentCount;
  const ringMean = ringSum / ringCount;
  return (ringMean - componentMean) / 255;
}

function mergeNearbyPips(
  components: ConnectedComponent[],
  distanceThreshold: number
): ConnectedComponent[] {
  const merged: ConnectedComponent[] = [];

  for (const component of components) {
    const existing = merged.find((candidate) => {
      return shouldMergePipComponents(candidate, component, distanceThreshold);
    });

    if (!existing) {
      merged.push(component);
      continue;
    }

    existing.minX = Math.min(existing.minX, component.minX);
    existing.maxX = Math.max(existing.maxX, component.maxX);
    existing.minY = Math.min(existing.minY, component.minY);
    existing.maxY = Math.max(existing.maxY, component.maxY);
    existing.width = existing.maxX - existing.minX + 1;
    existing.height = existing.maxY - existing.minY + 1;
    existing.area += component.area;
    existing.centerX = (existing.centerX + component.centerX) / 2;
    existing.centerY = (existing.centerY + component.centerY) / 2;
    existing.fillRatio = existing.area / (existing.width * existing.height);
  }

  return merged;
}

function shouldMergePipComponents(
  left: ConnectedComponent,
  right: ConnectedComponent,
  distanceThreshold: number
): boolean {
  const centerDistance = Math.hypot(
    left.centerX - right.centerX,
    left.centerY - right.centerY
  );

  if (centerDistance > distanceThreshold * 0.72) {
    return false;
  }

  const areaRatio = Math.max(left.area, right.area) / Math.max(Math.min(left.area, right.area), 1);

  if (areaRatio > 2.1) {
    return false;
  }

  const horizontalGap = Math.max(
    0,
    Math.max(left.minX, right.minX) - Math.min(left.maxX, right.maxX) - 1
  );
  const verticalGap = Math.max(
    0,
    Math.max(left.minY, right.minY) - Math.min(left.maxY, right.maxY) - 1
  );
  const maxGap = Math.max(horizontalGap, verticalGap);
  const nearTouching = maxGap <= Math.max(2, distanceThreshold * 0.12);
  const overlapping =
    horizontalGap === 0 &&
    verticalGap === 0 &&
    boxesOverlap(left, right);

  return nearTouching || overlapping;
}

function boxesOverlap(
  left: ConnectedComponent,
  right: ConnectedComponent
): boolean {
  return !(
    left.maxX < right.minX ||
    right.maxX < left.minX ||
    left.maxY < right.minY ||
    right.maxY < left.minY
  );
}

function edgePenalty(
  width: number,
  height: number,
  components: ConnectedComponent[]
): number {
  if (components.length === 0) {
    return 0;
  }

  const safeMarginX = width * 0.1;
  const safeMarginY = height * 0.1;
  const centeredCount = components.filter((component) => {
    return (
      component.centerX > safeMarginX &&
      component.centerX < width - safeMarginX &&
      component.centerY > safeMarginY &&
      component.centerY < height - safeMarginY
    );
  }).length;

  return centeredCount / components.length;
}

function consistencyScore(components: ConnectedComponent[]): number {
  if (components.length <= 1) {
    return 0.9;
  }

  const areas = components.map((component) => component.area);
  const mean = areas.reduce((sum, value) => sum + value, 0) / areas.length;
  const variance =
    areas.reduce((sum, value) => sum + (value - mean) ** 2, 0) / areas.length;

  return Math.max(0, 1 - Math.sqrt(variance) / Math.max(mean, 1));
}

function createGrayscaleBuffer(imageData: ImageData): Uint8Array {
  const grayscale = new Uint8Array(imageData.width * imageData.height);

  for (let index = 0; index < grayscale.length; index += 1) {
    const channelIndex = index * 4;
    grayscale[index] = Math.round(
      imageData.data[channelIndex] * 0.299 +
        imageData.data[channelIndex + 1] * 0.587 +
        imageData.data[channelIndex + 2] * 0.114
    );
  }

  return grayscale;
}

function normalizeImageData(imageData: ImageData, size: number): ImageData {
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = imageData.width;
  sourceCanvas.height = imageData.height;
  const sourceContext = sourceCanvas.getContext("2d");

  if (!sourceContext) {
    return imageData;
  }

  sourceContext.putImageData(imageData, 0, 0);

  const normalizedCanvas = document.createElement("canvas");
  normalizedCanvas.width = size;
  normalizedCanvas.height = size;
  const normalizedContext = normalizedCanvas.getContext("2d");

  if (!normalizedContext) {
    return imageData;
  }

  normalizedContext.imageSmoothingEnabled = true;
  normalizedContext.imageSmoothingQuality = "high";
  normalizedContext.drawImage(sourceCanvas, 0, 0, size, size);

  return normalizedContext.getImageData(0, 0, size, size);
}

function createAdaptiveDarkMask(
  grayscale: Uint8Array,
  width: number,
  height: number,
  meanBrightness: number
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const windowRadius = Math.max(10, Math.round(Math.min(width, height) * 0.065));
  const offset = Math.max(10, Math.min(28, meanBrightness * 0.1));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const minX = Math.max(0, x - windowRadius);
      const maxX = Math.min(width - 1, x + windowRadius);
      const minY = Math.max(0, y - windowRadius);
      const maxY = Math.min(height - 1, y + windowRadius);

      let localSum = 0;
      let localCount = 0;

      for (let sampleY = minY; sampleY <= maxY; sampleY += 2) {
        for (let sampleX = minX; sampleX <= maxX; sampleX += 2) {
          localSum += grayscale[sampleY * width + sampleX];
          localCount += 1;
        }
      }

      const localMean = localCount > 0 ? localSum / localCount : meanBrightness;
      const threshold = Math.max(18, Math.min(182, localMean - offset));
      mask[y * width + x] = grayscale[y * width + x] < threshold ? 1 : 0;
    }
  }

  return mask;
}

function cropImageData(imageData: ImageData, box: Box): ImageData {
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = imageData.width;
  sourceCanvas.height = imageData.height;
  const sourceContext = sourceCanvas.getContext("2d");

  if (!sourceContext) {
    return imageData;
  }

  sourceContext.putImageData(imageData, 0, 0);

  return sourceContext.getImageData(box.x, box.y, box.width, box.height);
}

function padBox(
  box: Box,
  maxWidth: number,
  maxHeight: number,
  paddingRatio: number
): Box {
  const paddingX = Math.round(box.width * paddingRatio);
  const paddingY = Math.round(box.height * paddingRatio);
  const x = Math.max(0, box.x - paddingX);
  const y = Math.max(0, box.y - paddingY);
  const width = Math.min(maxWidth - x, box.width + paddingX * 2);
  const height = Math.min(maxHeight - y, box.height + paddingY * 2);

  return {
    x,
    y,
    width,
    height
  };
}

function clampBox(box: Box, maxWidth: number, maxHeight: number): Box {
  const width = Math.min(box.width, maxWidth);
  const height = Math.min(box.height, maxHeight);
  const x = Math.min(Math.max(0, box.x), maxWidth - width);
  const y = Math.min(Math.max(0, box.y), maxHeight - height);

  return {
    x,
    y,
    width,
    height
  };
}

function findConnectedComponents(
  mask: Uint8Array,
  width: number,
  height: number
): ConnectedComponent[] {
  const visited = new Uint8Array(mask.length);
  const components: ConnectedComponent[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const startIndex = y * width + x;

      if (mask[startIndex] === 0 || visited[startIndex] === 1) {
        continue;
      }

      const queue = [startIndex];
      visited[startIndex] = 1;

      let queueIndex = 0;
      let area = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let sumX = 0;
      let sumY = 0;

      while (queueIndex < queue.length) {
        const index = queue[queueIndex];
        queueIndex += 1;
        const currentX = index % width;
        const currentY = Math.floor(index / width);

        area += 1;
        minX = Math.min(minX, currentX);
        maxX = Math.max(maxX, currentX);
        minY = Math.min(minY, currentY);
        maxY = Math.max(maxY, currentY);
        sumX += currentX;
        sumY += currentY;

        const neighbors = [
          index - 1,
          index + 1,
          index - width,
          index + width
        ];

        for (const neighborIndex of neighbors) {
          if (neighborIndex < 0 || neighborIndex >= mask.length) {
            continue;
          }

          const neighborX = neighborIndex % width;
          const neighborY = Math.floor(neighborIndex / width);

          if (Math.abs(neighborX - currentX) + Math.abs(neighborY - currentY) !== 1) {
            continue;
          }

          if (mask[neighborIndex] === 0 || visited[neighborIndex] === 1) {
            continue;
          }

          visited[neighborIndex] = 1;
          queue.push(neighborIndex);
        }
      }

      const componentWidth = maxX - minX + 1;
      const componentHeight = maxY - minY + 1;
      const boxArea = componentWidth * componentHeight;

      components.push({
        area,
        width: componentWidth,
        height: componentHeight,
        fillRatio: area / boxArea,
        centerX: sumX / area,
        centerY: sumY / area,
        minX,
        maxX,
        minY,
        maxY
      });
    }
  }

  return components;
}

function loadImage(imageUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      resolve(image);
    };

    image.onerror = () => {
      reject(new Error("Unable to load captured image for recognition."));
    };

    image.src = imageUrl;
  });
}
