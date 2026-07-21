import type { Landmark } from "../../types";

export type CustomHeadFitRuntime = {
  version: number;
  model: string;
  sampleCount: number;
  latentDimensions: number;
  explainedVariance: number;
  landmarkIndices: number[];
  landmarkRegions: string[];
  anchorVertexIndices: number[];
  pointWeights: number[];
  canonicalAnchors: number[];
  baseAnchors: number[];
  anchorModes: number[][];
  priorWeights: number[];
  weightModes: number[][];
  recommendedStrength: number;
  oralValidation: {
    randomSamples: number;
    maximumOutsideValidRangeRate: number;
    metrics: Record<string, {
      validP001: number;
      validP999: number;
      subspaceP001: number;
      subspaceP999: number;
      outsideValidRangeRate: number;
    }>;
  };
  solver: {
    iterations: number;
    regularization: number;
    huberDelta: number;
    latentLimit: number;
    latentRmsLimit: number;
    targetDeltaLimits: [number, number, number];
    frontCoordinateWeights: [number, number, number];
    profileCoordinateWeights: [number, number, number];
  };
};

export type CustomHeadGeometryDiagnostics = {
  initialRmse: number;
  fittedRmse: number;
  latentRms: number;
  iterations: number;
};

type GeometryView = {
  coordinates: Float64Array;
  neutralScore: number;
};

const IDENTITY_COMPONENTS = 253;
const AXES_PER_POINT = 3;
const REQUIRED_AXIS_LANDMARKS = [1, 10, 152, 234, 454] as const;

const clamp = (value: number, minimum: number, maximum: number) => (
  Math.min(maximum, Math.max(minimum, value))
);

function isFiniteNumberArray(value: unknown, length: number): value is number[] {
  return Array.isArray(value)
    && value.length === length
    && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

export function validateCustomHeadFitRuntime(value: unknown): CustomHeadFitRuntime {
  if (!value || typeof value !== "object") {
    throw new Error("The bundled custom-head fitting runtime is not an object.");
  }
  const runtime = value as CustomHeadFitRuntime;
  const pointCount = runtime.landmarkIndices?.length ?? 0;
  const coordinateCount = pointCount * AXES_PER_POINT;
  const modeCount = runtime.latentDimensions;
  const solver = runtime.solver;
  const valid = runtime.version === 2
    && runtime.model === "GNM Head v3"
    && Number.isInteger(runtime.sampleCount)
    && runtime.sampleCount >= 1_000
    && Number.isInteger(modeCount)
    && modeCount >= 16
    && modeCount <= 96
    && Number.isFinite(runtime.explainedVariance)
    && runtime.explainedVariance > 0.5
    && runtime.explainedVariance <= 1
    && pointCount >= 80
    && runtime.landmarkIndices.every((index) => Number.isInteger(index) && index >= 0 && index < 478)
    && REQUIRED_AXIS_LANDMARKS.every((index) => runtime.landmarkIndices.includes(index))
    && runtime.landmarkRegions?.length === pointCount
    && runtime.anchorVertexIndices?.length === pointCount
    && isFiniteNumberArray(runtime.pointWeights, pointCount)
    && isFiniteNumberArray(runtime.canonicalAnchors, coordinateCount)
    && isFiniteNumberArray(runtime.baseAnchors, coordinateCount)
    && runtime.anchorModes?.length === modeCount
    && runtime.anchorModes.every((mode) => isFiniteNumberArray(mode, coordinateCount))
    && isFiniteNumberArray(runtime.priorWeights, IDENTITY_COMPONENTS)
    && runtime.weightModes?.length === modeCount
    && runtime.weightModes.every((mode) => isFiniteNumberArray(mode, IDENTITY_COMPONENTS))
    && Number.isFinite(runtime.recommendedStrength)
    && runtime.recommendedStrength >= 0
    && runtime.recommendedStrength <= 1
    && Number.isInteger(runtime.oralValidation?.randomSamples)
    && runtime.oralValidation.randomSamples >= 1_000
    && Number.isFinite(runtime.oralValidation.maximumOutsideValidRangeRate)
    && runtime.oralValidation.maximumOutsideValidRangeRate <= 0.001
    && [
      "teethFrontClearance",
      "gumsFrontClearance",
      "tongueFrontClearance",
      "sockFrontClearance",
    ].every((name) => (runtime.oralValidation.metrics?.[name]?.subspaceP001 ?? 0) > 0)
    && solver
    && Number.isInteger(solver.iterations)
    && solver.iterations >= 1
    && solver.iterations <= 12
    && Number.isFinite(solver.regularization)
    && solver.regularization > 0
    && Number.isFinite(solver.huberDelta)
    && solver.huberDelta > 0
    && Number.isFinite(solver.latentLimit)
    && solver.latentLimit > 0
    && Number.isFinite(solver.latentRmsLimit)
    && solver.latentRmsLimit > 0
    && isFiniteNumberArray(solver.targetDeltaLimits, AXES_PER_POINT)
    && isFiniteNumberArray(solver.frontCoordinateWeights, AXES_PER_POINT)
    && isFiniteNumberArray(solver.profileCoordinateWeights, AXES_PER_POINT);
  if (!valid) {
    throw new Error("The bundled custom-head fitting runtime is incompatible with this app build.");
  }
  return runtime;
}

function normalize3(vector: Float64Array) {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!Number.isFinite(length) || length < 1e-8) {
    throw new Error("The face landmarks could not define a stable local axis.");
  }
  vector[0] /= length;
  vector[1] /= length;
  vector[2] /= length;
  return vector;
}

const subtract3 = (first: ArrayLike<number>, second: ArrayLike<number>) => new Float64Array([
  first[0] - second[0],
  first[1] - second[1],
  first[2] - second[2],
]);

const dot3 = (first: ArrayLike<number>, second: ArrayLike<number>) => (
  first[0] * second[0] + first[1] * second[1] + first[2] * second[2]
);

function selectedPoint(points: Float64Array, position: number) {
  const offset = position * AXES_PER_POINT;
  return points.subarray(offset, offset + AXES_PER_POINT);
}

function normalizeSelectedPoints(points: Float64Array, landmarkIndices: number[]) {
  const positionOf = (index: number) => {
    const position = landmarkIndices.indexOf(index);
    if (position < 0) throw new Error(`The fitting runtime is missing face landmark ${index}.`);
    return selectedPoint(points, position);
  };
  const negativeSide = positionOf(234);
  const positiveSide = positionOf(454);
  const forehead = positionOf(10);
  const chin = positionOf(152);
  const nose = positionOf(1);
  const xAxis = normalize3(subtract3(positiveSide, negativeSide));
  const yAxis = subtract3(forehead, chin);
  const xProjection = dot3(yAxis, xAxis);
  for (let axis = 0; axis < AXES_PER_POINT; axis += 1) yAxis[axis] -= xAxis[axis] * xProjection;
  normalize3(yAxis);
  const zAxis = normalize3(new Float64Array([
    xAxis[1] * yAxis[2] - xAxis[2] * yAxis[1],
    xAxis[2] * yAxis[0] - xAxis[0] * yAxis[2],
    xAxis[0] * yAxis[1] - xAxis[1] * yAxis[0],
  ]));
  const origin = new Float64Array([
    (negativeSide[0] + positiveSide[0]) * 0.5,
    (negativeSide[1] + positiveSide[1]) * 0.5,
    (negativeSide[2] + positiveSide[2]) * 0.5,
  ]);
  if (dot3(zAxis, subtract3(nose, origin)) < 0) {
    zAxis[0] *= -1;
    zAxis[1] *= -1;
    zAxis[2] *= -1;
  }
  const faceHeight = Math.hypot(
    forehead[0] - chin[0],
    forehead[1] - chin[1],
    forehead[2] - chin[2],
  );
  if (!Number.isFinite(faceHeight) || faceHeight < 1e-8) {
    throw new Error("The face landmarks produced an invalid head height.");
  }
  const normalized = new Float64Array(points.length);
  for (let point = 0; point < landmarkIndices.length; point += 1) {
    const source = selectedPoint(points, point);
    const relative = subtract3(source, origin);
    const offset = point * AXES_PER_POINT;
    normalized[offset] = dot3(relative, xAxis) / faceHeight;
    normalized[offset + 1] = dot3(relative, yAxis) / faceHeight;
    normalized[offset + 2] = dot3(relative, zAxis) / faceHeight;
  }
  return normalized;
}

export function canonicalizeCustomHeadLandmarks(
  landmarks: Landmark[],
  imageAspect: number,
  landmarkIndices: number[],
) {
  if (!Number.isFinite(imageAspect) || imageAspect <= 0) {
    throw new Error("The source image has an invalid aspect ratio.");
  }
  const selected = new Float64Array(landmarkIndices.length * AXES_PER_POINT);
  for (let position = 0; position < landmarkIndices.length; position += 1) {
    const index = landmarkIndices[position];
    const landmark = landmarks[index];
    if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y) || !Number.isFinite(landmark.z)) {
      throw new Error(`MediaPipe did not return required face landmark ${index}.`);
    }
    const offset = position * AXES_PER_POINT;
    // Image X/Y are independently normalized and screen Y points down. Z uses
    // approximately X scale and is negative toward the camera.
    selected[offset] = landmark.x * imageAspect;
    selected[offset + 1] = -landmark.y;
    selected[offset + 2] = -landmark.z * imageAspect;
  }
  return normalizeSelectedPoints(selected, landmarkIndices);
}

function expressionReliability(score: number) {
  return clamp((score - 0.15) / 0.85, 0, 1);
}

export function buildCustomHeadTarget(
  runtime: CustomHeadFitRuntime,
  front: GeometryView,
  profile: GeometryView | null,
) {
  const coordinateCount = runtime.baseAnchors.length;
  if (front.coordinates.length !== coordinateCount || (profile && profile.coordinates.length !== coordinateCount)) {
    throw new Error("The analyzed photos do not match the custom-head fitting runtime.");
  }
  const target = new Float64Array(coordinateCount);
  const coordinateWeights = profile
    ? new Float64Array([1, 1, runtime.solver.profileCoordinateWeights[2]])
    : new Float64Array(runtime.solver.frontCoordinateWeights);
  const frontNeutral = expressionReliability(front.neutralScore);
  const profileNeutral = profile ? expressionReliability(profile.neutralScore) : 0;
  for (let point = 0; point < runtime.landmarkIndices.length; point += 1) {
    const region = runtime.landmarkRegions[point];
    const frontExpressionScale = region === "mouth"
      ? 0.2 + frontNeutral * 0.8
      : region === "cheeks" ? 0.65 + frontNeutral * 0.35 : 1;
    const profileExpressionScale = region === "mouth"
      ? 0.2 + profileNeutral * 0.8
      : region === "cheeks" ? 0.65 + profileNeutral * 0.35 : 1;
    for (let axis = 0; axis < AXES_PER_POINT; axis += 1) {
      const coordinate = point * AXES_PER_POINT + axis;
      const canonical = runtime.canonicalAnchors[coordinate];
      const frontResidual = (front.coordinates[coordinate] - canonical) * frontExpressionScale;
      let residual = frontResidual;
      if (profile) {
        const frontWeight = runtime.solver.frontCoordinateWeights[axis];
        const profileWeight = runtime.solver.profileCoordinateWeights[axis];
        const profileResidual = (profile.coordinates[coordinate] - canonical) * profileExpressionScale;
        residual = (frontResidual * frontWeight + profileResidual * profileWeight)
          / Math.max(1e-8, frontWeight + profileWeight);
      }
      const limit = runtime.solver.targetDeltaLimits[axis];
      target[coordinate] = runtime.baseAnchors[coordinate] + clamp(residual, -limit, limit);
    }
  }
  return { target, coordinateWeights };
}

function solveLinearSystem(matrix: Float64Array, values: Float64Array, size: number) {
  const coefficients = matrix.slice();
  const result = values.slice();
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    let pivotMagnitude = Math.abs(coefficients[column * size + column]);
    for (let row = column + 1; row < size; row += 1) {
      const magnitude = Math.abs(coefficients[row * size + column]);
      if (magnitude > pivotMagnitude) {
        pivot = row;
        pivotMagnitude = magnitude;
      }
    }
    if (!Number.isFinite(pivotMagnitude) || pivotMagnitude < 1e-12) {
      throw new Error("The custom-head geometry solve became singular.");
    }
    if (pivot !== column) {
      for (let entry = column; entry < size; entry += 1) {
        const first = column * size + entry;
        const second = pivot * size + entry;
        [coefficients[first], coefficients[second]] = [coefficients[second], coefficients[first]];
      }
      [result[column], result[pivot]] = [result[pivot], result[column]];
    }
    const diagonal = coefficients[column * size + column];
    for (let row = column + 1; row < size; row += 1) {
      const factor = coefficients[row * size + column] / diagonal;
      if (factor === 0) continue;
      coefficients[row * size + column] = 0;
      for (let entry = column + 1; entry < size; entry += 1) {
        coefficients[row * size + entry] -= factor * coefficients[column * size + entry];
      }
      result[row] -= factor * result[column];
    }
  }
  const solution = new Float64Array(size);
  for (let row = size - 1; row >= 0; row -= 1) {
    let value = result[row];
    for (let column = row + 1; column < size; column += 1) {
      value -= coefficients[row * size + column] * solution[column];
    }
    solution[row] = value / coefficients[row * size + row];
  }
  return solution;
}

function latentRms(latent: Float64Array) {
  let energy = 0;
  for (const value of latent) energy += value * value;
  return Math.sqrt(energy / Math.max(1, latent.length));
}

function clampLatent(latent: Float64Array, limit: number, rmsLimit: number) {
  for (let mode = 0; mode < latent.length; mode += 1) {
    latent[mode] = clamp(latent[mode], -limit, limit);
  }
  const rms = latentRms(latent);
  if (rms > rmsLimit) {
    const scale = rmsLimit / rms;
    for (let mode = 0; mode < latent.length; mode += 1) latent[mode] *= scale;
  }
}

function predictedDelta(runtime: CustomHeadFitRuntime, latent: Float64Array) {
  const prediction = new Float64Array(runtime.baseAnchors.length);
  for (let mode = 0; mode < latent.length; mode += 1) {
    const amount = latent[mode];
    const shape = runtime.anchorModes[mode];
    for (let coordinate = 0; coordinate < prediction.length; coordinate += 1) {
      prediction[coordinate] += shape[coordinate] * amount;
    }
  }
  return prediction;
}

function weightedRmse(
  residual: Float64Array,
  runtime: CustomHeadFitRuntime,
  coordinateWeights: Float64Array,
) {
  let energy = 0;
  let totalWeight = 0;
  for (let coordinate = 0; coordinate < residual.length; coordinate += 1) {
    const point = Math.floor(coordinate / AXES_PER_POINT);
    const axis = coordinate % AXES_PER_POINT;
    const weight = runtime.pointWeights[point] * coordinateWeights[axis];
    energy += residual[coordinate] * residual[coordinate] * weight * weight;
    totalWeight += weight * weight;
  }
  return Math.sqrt(energy / Math.max(totalWeight, 1e-8));
}

export function solveCustomHeadGeometry(
  runtime: CustomHeadFitRuntime,
  target: Float64Array,
  coordinateWeights: Float64Array,
  currentWeights: Float32Array | null,
  strength: number,
) {
  const modeCount = runtime.latentDimensions;
  const coordinateCount = runtime.baseAnchors.length;
  if (target.length !== coordinateCount || coordinateWeights.length !== AXES_PER_POINT) {
    throw new Error("The custom-head geometry target has an incompatible shape.");
  }
  const desiredDelta = new Float64Array(coordinateCount);
  for (let coordinate = 0; coordinate < coordinateCount; coordinate += 1) {
    desiredDelta[coordinate] = target[coordinate] - runtime.baseAnchors[coordinate];
  }
  const latent = new Float64Array(modeCount);
  let completedIterations = 0;
  for (let iteration = 0; iteration < runtime.solver.iterations; iteration += 1) {
    const prediction = predictedDelta(runtime, latent);
    const normal = new Float64Array(modeCount * modeCount);
    const rightHandSide = new Float64Array(modeCount);
    for (let coordinate = 0; coordinate < coordinateCount; coordinate += 1) {
      const point = Math.floor(coordinate / AXES_PER_POINT);
      const axis = coordinate % AXES_PER_POINT;
      const residual = desiredDelta[coordinate] - prediction[coordinate];
      const baseWeight = runtime.pointWeights[point] * coordinateWeights[axis];
      const robustWeight = Math.abs(residual) <= runtime.solver.huberDelta
        ? 1
        : runtime.solver.huberDelta / Math.max(Math.abs(residual), 1e-8);
      const weight = baseWeight * baseWeight * robustWeight;
      for (let row = 0; row < modeCount; row += 1) {
        const rowValue = runtime.anchorModes[row][coordinate];
        rightHandSide[row] += rowValue * weight * residual;
        const rowOffset = row * modeCount;
        for (let column = 0; column <= row; column += 1) {
          normal[rowOffset + column] += rowValue * weight * runtime.anchorModes[column][coordinate];
        }
      }
    }
    for (let row = 0; row < modeCount; row += 1) {
      const rowOffset = row * modeCount;
      for (let column = 0; column < row; column += 1) {
        normal[column * modeCount + row] = normal[rowOffset + column];
      }
      normal[rowOffset + row] += runtime.solver.regularization;
      rightHandSide[row] -= runtime.solver.regularization * latent[row];
    }
    const step = solveLinearSystem(normal, rightHandSide, modeCount);
    let stepEnergy = 0;
    for (let mode = 0; mode < modeCount; mode += 1) {
      latent[mode] += step[mode];
      stepEnergy += step[mode] * step[mode];
    }
    clampLatent(latent, runtime.solver.latentLimit, runtime.solver.latentRmsLimit);
    completedIterations = iteration + 1;
    if (Math.sqrt(stepEnergy / modeCount) < 1e-5) break;
  }

  const finalPrediction = predictedDelta(runtime, latent);
  const initialResidual = desiredDelta;
  const finalResidual = new Float64Array(coordinateCount);
  for (let coordinate = 0; coordinate < coordinateCount; coordinate += 1) {
    finalResidual[coordinate] = desiredDelta[coordinate] - finalPrediction[coordinate];
  }
  const fitted = new Float32Array(IDENTITY_COMPONENTS);
  for (let component = 0; component < IDENTITY_COMPONENTS; component += 1) {
    let value = runtime.priorWeights[component];
    for (let mode = 0; mode < modeCount; mode += 1) {
      value += latent[mode] * runtime.weightModes[mode][component];
    }
    fitted[component] = value;
  }
  const source = currentWeights?.length === IDENTITY_COMPONENTS
    ? currentWeights
    : new Float32Array(runtime.priorWeights);
  const blend = clamp(strength, 0, 1);
  for (let component = 0; component < IDENTITY_COMPONENTS; component += 1) {
    fitted[component] = source[component] + (fitted[component] - source[component]) * blend;
  }
  const diagnostics: CustomHeadGeometryDiagnostics = {
    initialRmse: weightedRmse(initialResidual, runtime, coordinateWeights),
    fittedRmse: weightedRmse(finalResidual, runtime, coordinateWeights),
    latentRms: latentRms(latent),
    iterations: completedIterations,
  };
  return { weights: fitted, latent, diagnostics };
}
