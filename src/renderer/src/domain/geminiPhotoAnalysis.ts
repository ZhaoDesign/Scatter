/**
 * Prompts and parsing for the photo-only Gemini path. The target image is
 * analysis/comparison evidence and must never be forwarded as a PixVerse ref.
 */
export const geminiPhotoReversePrompt = `请分析随请求提供的唯一目标写真，并只返回一个 JSON 对象，不要 Markdown 代码围栏或额外说明。JSON 字段必须为：
{
  "summary": "简短记录画面中可直接观察到的事实与不确定项",
  "modelPortraitPrompt": "可直接交给 PixVerse Nano Banana 2.1 的完整纯文字生图提示词",
  "sceneRecreationPrompt": "可直接交给 PixVerse Nano Banana 2.1 的完整纯文字生图提示词"
}

共同规则：只写图中确实可见的事实；不猜姓名、具体身份、族裔、人物关系或被遮挡细节；看不清的内容省略或标记待确认。输出面向 9:16 竖幅写真，禁止生成任何界面、边框、水印或额外文字。

modelPortraitPrompt：只复述主体清晰可见的五官结构、面部轮廓、可见发型和发色，作为文字描述，不使用目标图作生图参考。生成一张新的肖像：人物自然坐在沙发上，面向并看着镜头，穿简洁日常服装；背景简洁、光线自然、头肩至半身构图。不要复刻目标图中的车辆、姿势、服装、背景、光线、构图或道具；不要猜测不可见的身体特征。

sceneRecreationPrompt：尽量准确复刻目标写真可观察到的主体姿态、手部位置、取景和留白、车辆/车窗结构、红黑色背景、光线方向与明暗、色彩、材质和摄影质感。人物面部身份与发型只引用 @图1，且 @图1 只负责面部身份和发型；不得把 @图1 的沙发姿态、日常服装、背景、光线和构图带入本图。不要把本次随请求提供的目标图写成 @图1，也不要指示生成器读取目标图作为参考。对无法确认的细节不要补造。`;

export interface GeminiPhotoAnalysisOutput {
  summary: string;
  modelPortraitPrompt: string;
  sceneRecreationPrompt: string;
}

function cleanJsonEnvelope(text: string): string {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

export function parseGeminiPhotoAnalysis(text: string): GeminiPhotoAnalysisOutput | null {
  try {
    const value = JSON.parse(cleanJsonEnvelope(text)) as Record<string, unknown>;
    const summary = typeof value.summary === "string" ? value.summary.trim() : "";
    const modelPortraitPrompt = typeof value.modelPortraitPrompt === "string" ? value.modelPortraitPrompt.trim() : "";
    const sceneRecreationPrompt = typeof value.sceneRecreationPrompt === "string" ? value.sceneRecreationPrompt.trim() : "";
    if (modelPortraitPrompt.length < 30 || sceneRecreationPrompt.length < 30) return null;
    return { summary, modelPortraitPrompt, sceneRecreationPrompt };
  } catch {
    return null;
  }
}
