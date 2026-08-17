export type ImageAnalysisRequest = {
  /** Raw image bytes encoded as base64 (no data-url prefix). */
  imageBase64: string;
  mimeType: string;
  instruction: string;
};

export type ImageAnalysisOutput = {
  summary: string;
  extractedText: string;
  details: string[];
};

/**
 * Pluggable vision provider. Implementations must call a model that truly
 * supports image input — never fabricate results from text-only models.
 */
export interface ImageAnalysisProvider {
  analyzeImage(request: ImageAnalysisRequest): Promise<ImageAnalysisOutput>;
}
