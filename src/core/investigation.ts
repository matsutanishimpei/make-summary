import { FeatureContextError } from "./errors.js";
import type {
  Investigation,
  InvestigationFile,
  InvestigationSummaryDetails,
  Priority
} from "./types.js";

export function parseInvestigation(raw: string): Investigation {
  try {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    let value: unknown = JSON.parse(cleaned);
    if (
      value &&
      typeof value === "object" &&
      "response" in value &&
      typeof (value as { response: unknown }).response === "string"
    ) {
      value = JSON.parse((value as { response: string }).response.trim());
    }
    return validateInvestigation(value);
  } catch (error) {
    if (error instanceof FeatureContextError) throw error;
    throw new FeatureContextError(
      "INVALID_JSON",
      undefined,
      error instanceof Error ? `${error.message}\n${raw.slice(0, 4_000)}` : raw.slice(0, 4_000)
    );
  }
}

export function validateInvestigation(value: unknown): Investigation {
  if (!value || typeof value !== "object") {
    throw new FeatureContextError("INVALID_JSON", undefined, "JSON root must be an object");
  }
  const input = value as Record<string, unknown>;
  if (typeof input.feature !== "string" || !Array.isArray(input.files)) {
    throw new FeatureContextError("INVALID_JSON", undefined, "feature/files are missing");
  }
  const files: InvestigationFile[] = input.files.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new FeatureContextError("INVALID_JSON", undefined, `files[${index}] is invalid`);
    }
    const file = item as Record<string, unknown>;
    const priority = file.priority;
    if (!["core", "supporting", "test"].includes(String(priority))) {
      throw new FeatureContextError("INVALID_JSON", undefined, `files[${index}].priority is invalid`);
    }
    for (const field of ["path", "role", "reason", "group"]) {
      if (typeof file[field] !== "string") {
        throw new FeatureContextError("INVALID_JSON", undefined, `files[${index}].${field} is invalid`);
      }
    }
    return {
      path: file.path as string,
      role: file.role as string,
      reason: file.reason as string,
      priority: priority as Priority,
      group: file.group as string,
      recommended: file.recommended !== false,
      ...(typeof file.summary === "string" ? { summary: file.summary } : {})
    };
  });
  const summaryDetails = parseSummaryDetails(input.summaryDetails);
  return {
    feature: input.feature,
    overview: typeof input.overview === "string" ? input.overview : undefined,
    flow: Array.isArray(input.flow) ? input.flow.filter((item): item is string => typeof item === "string") : [],
    files,
    ...(summaryDetails ? { summaryDetails } : {}),
    uncertainties: Array.isArray(input.uncertainties)
      ? input.uncertainties.filter((item): item is string => typeof item === "string")
      : []
  };
}

function parseSummaryDetails(value: unknown): InvestigationSummaryDetails | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  return {
    responsibilities: stringArray(input.responsibilities),
    stateAndDataFlow: stringArray(input.stateAndDataFlow),
    apis: stringArray(input.apis),
    externalDependencies: stringArray(input.externalDependencies),
    changeCautions: stringArray(input.changeCautions)
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
