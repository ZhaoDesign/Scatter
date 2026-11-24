/**
 * Focused pure-function checks for per-task reference alias normalization.
 * Runs without any test framework: esbuild bundles the TS domain module to a
 * temp ESM, then we assert on role changes, normalization and Markdown payloads.
 * All graphs are in-memory NOT-RUN fixtures; no UI, runners or media conversion.
 *
 *   npm run test:reference-assignments
 */
import { build } from "esbuild";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const dir = mkdtempSync(path.join(tmpdir(), "scatter-ref-test-"));
const outfile = path.join(dir, "ref.mjs");
const entry = path.join(dir, "entry.ts");
const domainPath = path.join(root, "src/renderer/src/domain/referenceAssignments.ts").split(path.sep).join("/");
const markdownPath = path.join(root, "src/renderer/src/lib/markdown.ts").split(path.sep).join("/");
const replicationSectionsPath = path.join(root, "src/renderer/src/domain/replicationSections.ts").split(path.sep).join("/");
const templateDemoPath = path.join(root, "src/renderer/src/domain/templateReplicationDemo.ts").split(path.sep).join("/");
writeFileSync(entry, `
export * from "${domainPath}";
export { buildMarkdown } from "${markdownPath}";
export * from "${replicationSectionsPath}";
export { createTemplateReplicationDemoDocument } from "${templateDemoPath}";
`);
await build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile
});
const mod = await import("file://" + outfile);
const { normalizeTaskAssignments, depthOutputVideoIds, autoAnalysisSourceIdsForTask, defaultAliasFor, updateTaskReferenceRole, replaceAliasInBody, canUseGenerationMedia, targetAnalysisVideoIds, parseReplicationSections, normalizeReplicationScopes, replicationScopeSectionSpecs, replicationSectionSpecs, hasContinuousVideoSegmentCoverage, isReplicationPipelineCompatible, isReplicationPromptCompatible, createTemplateReplicationDemoDocument } = mod;
const { buildMarkdown } = mod;

let passed = 0;
let failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    console.log("  ok -", name);
  } else {
    failed += 1;
    console.error("FAIL -", name);
    console.error("   expected:", e);
    console.error("   actual:  ", a);
  }
}

const mkNode = (id, nodeKind, extra = {}) => ({
  id,
  type: "task",
  position: { x: 0, y: 0 },
  data: { nodeKind, title: id, body: "", attachments: [], ...extra }
});
const edge = (source, target, targetHandle) => ({ id: `${source}->${target}`, source, target, targetHandle });

// --- Graph builders -------------------------------------------------------
// videoIn ---> depthNode ---> videoOut  (depth conversion chain)
// videoOut ---> taskA                  (task A consumes the depth output)
// videoIn ---> taskA / taskB           (direct connections under test)

function buildGraph({ connectInputToA, connectInputToB = false, depthOutputNodeId = "videoOut" } = {}) {
  const nodes = [
    mkNode("taskA", "task"),
    mkNode("taskB", "task"),
    mkNode("videoIn", "video-reference"),
    mkNode("videoOut", "video-reference"),
    mkNode("depthNode", "depth-conversion", { depthOutputNodeId })
  ];
  const edges = [
    edge("videoIn", "depthNode"),
    edge("depthNode", "videoOut"),
    edge("videoOut", "taskA")
  ];
  if (connectInputToA) edges.push(edge("videoIn", "taskA"));
  if (connectInputToB) edges.push(edge("videoIn", "taskB"));
  return { nodes, edges };
}

function normalize(nodes, edges, taskId) {
  const task = nodes.find((n) => n.id === taskId);
  const depthOutputIds = depthOutputVideoIds(nodes, edges);
  return normalizeTaskAssignments(task, nodes, edges, depthOutputIds).assignments;
}
function normalizeFull(nodes, edges, taskId) {
  const task = nodes.find((n) => n.id === taskId);
  const depthOutputIds = depthOutputVideoIds(nodes, edges);
  return normalizeTaskAssignments(task, nodes, edges, depthOutputIds);
}

console.log("\n[1] Order A: connect input to task first, then add depth chain");
{
  // Phase 1: only videoIn -> taskA, no depth chain yet.
  let nodes = [mkNode("taskA", "task"), mkNode("videoIn", "video-reference")];
  let edges = [edge("videoIn", "taskA")];
  let assignments = normalize(nodes, edges, "taskA");
  check("input gets @视频1 when no depth chain",
    assignments.videoIn, { kind: "video", alias: "@视频1", purpose: "", order: 1 });

  // Phase 2: add depth chain videoIn -> depth -> videoOut and consume videoOut.
  nodes = [
    ...nodes,
    mkNode("videoOut", "video-reference"),
    mkNode("depthNode", "depth-conversion", { depthOutputNodeId: "videoOut" })
  ];
  edges = [...edges, edge("videoIn", "depthNode"), edge("depthNode", "videoOut"), edge("videoOut", "taskA")];
  // Preserve the previously assigned alias on videoIn (simulating real persisted state).
  nodes.find((n) => n.id === "taskA").data.referenceAssignments = assignments;
  assignments = normalize(nodes, edges, "taskA");
  check("input flips to analysis-only once depth chain is consumed",
    assignments.videoIn, { kind: "video", alias: "", purpose: "", order: 1, analysisOnly: true });
  check("depth output gets numbered @视频1 (input no longer takes a slot)",
    assignments.videoOut, { kind: "video", alias: "@视频1", purpose: "", order: 2 });
}

console.log("\n[2] Order B: depth chain exists first, then connect input to task");
{
  const { nodes, edges } = buildGraph({ connectInputToA: true });
  const assignments = normalize(nodes, edges, "taskA");
  // Connected-media order follows edge order: videoOut->taskA comes before videoIn->taskA.
  check("input is auto analysis-only from the start",
    assignments.videoIn, { kind: "video", alias: "", purpose: "", order: 2, analysisOnly: true });
  check("depth output is @视频1",
    assignments.videoOut, { kind: "video", alias: "@视频1", purpose: "", order: 1 });
}

console.log("\n[3] Other task isolation: same input video does not become analysis-only for taskB");
{
  const { nodes, edges } = buildGraph({ connectInputToA: true, connectInputToB: true });
  const a = normalize(nodes, edges, "taskA");
  const b = normalize(nodes, edges, "taskB");
  check("taskA: input analysis-only", a.videoIn, { kind: "video", alias: "", purpose: "", order: 2, analysisOnly: true });
  check("taskB: input still numbered @视频1", b.videoIn, { kind: "video", alias: "@视频1", purpose: "", order: 1 });
  const autoA = [...autoAnalysisSourceIdsForTask(nodes, edges, "taskA")];
  const autoB = [...autoAnalysisSourceIdsForTask(nodes, edges, "taskB")];
  check("autoAnalysis set per task", { autoA, autoB }, { autoA: ["videoIn"], autoB: [] });
}

console.log("\n[4] Manual override wins over topology");
{
  const { nodes, edges } = buildGraph({ connectInputToA: true });
  // User explicitly chose to keep videoIn as a numbered reference in taskA.
  nodes.find((n) => n.id === "taskA").data.referenceAssignments = {
    videoIn: { kind: "video", alias: "@视频5", purpose: "", order: 1, analysisOnly: false, analysisOnlyManual: true },
    videoOut: { kind: "video", alias: "@视频1", purpose: "", order: 2 }
  };
  const assignments = normalize(nodes, edges, "taskA");
  check("manual numbered alias is preserved despite topology",
    assignments.videoIn, { kind: "video", alias: "@视频5", purpose: "", order: 1, analysisOnly: false, analysisOnlyManual: true });
}

console.log("\n[5] Disconnect depth output: auto role reverts to numbered");
{
  // Start from order-B state, then remove videoOut -> taskA edge.
  let { nodes, edges } = buildGraph({ connectInputToA: true });
  let assignments = normalize(nodes, edges, "taskA");
  check("before disconnect: input analysis-only", assignments.videoIn.analysisOnly, true);

  edges = edges.filter((e) => !(e.source === "videoOut" && e.target === "taskA"));
  nodes.find((n) => n.id === "taskA").data.referenceAssignments = assignments;
  assignments = normalize(nodes, edges, "taskA");
  check("after disconnect: input reverts to @视频1",
    assignments.videoIn, { kind: "video", alias: "@视频1", purpose: "", order: 2, analysisOnly: false });
  check("depth output record pruned (no longer connected)",
    assignments.videoOut, undefined);
}

console.log("\n[6] Topology flip to analysis-only strips the old alias token from body");
{
  // Start from order-A phase-1 state: videoIn -> taskA, body references @视频1.
  let nodes = [
    { ...mkNode("taskA", "task"), data: { nodeKind: "task", title: "taskA", body: "用 @视频1 作为参考。" } },
    mkNode("videoIn", "video-reference")
  ];
  let edges = [edge("videoIn", "taskA")];
  let result = normalizeFull(nodes, edges, "taskA");
  nodes.find((n) => n.id === "taskA").data.referenceAssignments = result.assignments;
  check("phase1: videoIn numbered @视频1, body untouched",
    { alias: result.assignments.videoIn.alias, body: result.body },
    { alias: "@视频1", body: undefined });

  // Add the depth chain; videoIn must flip to analysis-only and its @视频1
  // token must be removed from body in the SAME pass.
  nodes = [
    ...nodes,
    mkNode("videoOut", "video-reference"),
    mkNode("depthNode", "depth-conversion", { depthOutputNodeId: "videoOut" })
  ];
  edges = [...edges, edge("videoIn", "depthNode"), edge("depthNode", "videoOut"), edge("videoOut", "taskA")];
  result = normalizeFull(nodes, edges, "taskA");
  check("videoIn becomes analysis-only, alias cleared",
    result.assignments.videoIn, { kind: "video", alias: "", purpose: "", order: 1, analysisOnly: true });
  check("old @视频1 token removed from body in same pass",
    result.body, "用  作为参考。");
  check("depth output takes @视频1 without colliding with body",
    result.assignments.videoOut.alias, "@视频1");
}

console.log("\n[7] Restored analysis-only video never duplicates an existing @视频1");
{
  // taskA currently has: target=analysis-only (alias ""), other=@视频1.
  // Iteration order puts target FIRST. Removing the depth output edge flips
  // target back to numbered; it must take @视频2 (other already holds @视频1).
  const nodes = [
    { ...mkNode("taskA", "task"), data: { nodeKind: "task", title: "taskA", body: "" } },
    mkNode("target", "video-reference"),
    mkNode("other", "video-reference"),
    mkNode("videoOut", "video-reference"),
    mkNode("depthNode", "depth-conversion", { depthOutputNodeId: "videoOut" })
  ];
  // target feeds depth; depth output consumes taskA; other is a plain reference.
  const edges = [
    edge("target", "depthNode"),
    edge("depthNode", "videoOut"),
    edge("videoOut", "taskA"),
    edge("target", "taskA"),
    edge("other", "taskA")
  ];
  nodes.find((n) => n.id === "taskA").data.referenceAssignments = {
    target: { kind: "video", alias: "", purpose: "", order: 1, analysisOnly: true },
    other: { kind: "video", alias: "@视频1", purpose: "", order: 2 }
  };
  // Remove depth output consumption edge -> target is no longer auto analysis-only.
  const edgesNoDepth = edges.filter((e) => !(e.source === "videoOut" && e.target === "taskA"));
  const result = normalizeFull(nodes, edgesNoDepth, "taskA");
  check("target restores to @视频2 (not @视频1)",
    result.assignments.target, { kind: "video", alias: "@视频2", purpose: "", order: 1, analysisOnly: false });
  check("other keeps @视频1",
    result.assignments.other, { kind: "video", alias: "@视频1", purpose: "", order: 2 });
}

console.log("\n[8] Same commit: restoring video takes freed @视频1; disconnected material's token is pruned");
{
  // taskA body references @视频1 (owned by "other"). In one normalization pass:
  //  - depth output edge removed -> target flips from analysis-only to numbered
  //  - "other" edge removed -> other pruned, freeing @视频1 and its body token.
  // Iteration order puts target FIRST; it must still pick @视频1 (not @视频2)
  // because other's number is released up-front, and the body's @视频1 token
  // must be removed (no orphan pointing at a reconnected future material).
  const nodes = [
    { ...mkNode("taskA", "task"), data: { nodeKind: "task", title: "taskA", body: "other 是 @视频1。" } },
    mkNode("target", "video-reference"),
    mkNode("other", "video-reference"),
    mkNode("videoOut", "video-reference"),
    mkNode("depthNode", "depth-conversion", { depthOutputNodeId: "videoOut" })
  ];
  const edges = [
    edge("target", "depthNode"),
    edge("depthNode", "videoOut"),
    edge("videoOut", "taskA"),
    edge("target", "taskA"),
    edge("other", "taskA")
  ];
  nodes.find((n) => n.id === "taskA").data.referenceAssignments = {
    target: { kind: "video", alias: "", purpose: "", order: 1, analysisOnly: true },
    other: { kind: "video", alias: "@视频1", purpose: "", order: 2 }
  };
  // Remove depth-output edge AND the other->taskA edge in the same pass.
  const edgesEdited = edges.filter((e) =>
    !(e.source === "videoOut" && e.target === "taskA")
    && !(e.source === "other" && e.target === "taskA")
  );
  const result = normalizeFull(nodes, edgesEdited, "taskA");
  check("target restores to freed @视频1 (not @视频2)",
    result.assignments.target, { kind: "video", alias: "@视频1", purpose: "", order: 1, analysisOnly: false });
  check("other pruned (edge removed)", result.assignments.other, undefined);
  check("other's @视频1 token removed from body", result.body, "other 是 。");
}

console.log("\n[9] Markdown labels: manual analysis-only vs topology target video");
{
  // taskA with two videos:
  //   - manualVid: user marked analysisOnlyManual=true (plain reference, no depth chain)
  //   - plainVid: a normal numbered reference @视频1
  const nodes = [
    mkNode("taskA", "task", { body: "写提示词", planMode: false, referenceAssignments: {
      manualVid: { kind: "video", alias: "", purpose: "只看", order: 1, analysisOnly: true, analysisOnlyManual: true },
      plainVid: { kind: "video", alias: "@视频1", purpose: "", order: 2 }
    }}),
    mkNode("manualVid", "video-reference"),
    mkNode("plainVid", "video-reference")
  ];
  const edges = [edge("manualVid", "taskA"), edge("plainVid", "taskA")];
  const md = buildMarkdown(nodes, edges, "taskA", "node", "proj", "/tmp/proj", "zh").markdown;
  check("manual analysis-only uses dedicated label", md.includes("任务指定分析源（不编号，不作为生成参考）"), true);
  check("does NOT call it target video", md.includes("目标视频分析源"), false);
  check("connection map labels manual analysis edge",
    /manualVid.*任务指定分析源/.test(md), true);
  check("plain reference still carries @视频1", md.includes("@视频1"), true);
}

console.log("\n[10] Analysis-only images and videos do not reserve numbered slots");
{
  const assignments = {
    image: { kind: "image", alias: "@图1", purpose: "", order: 1, analysisOnly: true },
    video: { kind: "video", alias: "@视频1", purpose: "", order: 2, analysisOnly: true }
  };
  for (const kind of ["image", "video"]) {
    check(`${kind}: analysis-only default is empty`, defaultAliasFor(assignments, kind, false, true), "");
    check(`${kind}: ignored stale analysis alias frees slot 1`, defaultAliasFor(assignments, kind, false), kind === "image" ? "@图1" : "@视频1");
  }
  check("empty old alias cannot inject tokens into body", replaceAliasInBody("plain text", "", "@图1"), "plain text");
}

console.log("\n[11] Image role switching clears exact tokens and restores a conflict-free slot");
{
  const assignments = {
    target: { kind: "image", alias: "@图1", purpose: "scene only", order: 4 },
    other: { kind: "image", alias: "@图10", purpose: "identity", order: 2 },
    reserved: { kind: "image", alias: "@图2", purpose: "", order: 3 },
    video: { kind: "video", alias: "@视频1", purpose: "motion", order: 1 }
  };
  const before = JSON.stringify(assignments);
  const body = "看 @图1；保留 @图10、@图2、@视频1。再次 @图1。";
  const analysis = updateTaskReferenceRole(assignments, body, "target", true);
  check("image becomes manually analysis-only", analysis.assignments.target,
    { ...assignments.target, alias: "", analysisOnly: true, analysisOnlyManual: true });
  check("clears every @图1 but not @图10 or other media tokens", analysis.body,
    "看 ；保留 @图10、@图2、@视频1。再次 。");
  check("original records are not mutated", JSON.stringify(assignments), before);
  check("other image record retains identity", analysis.assignments.other === assignments.other, true);

  const nodes = [
    mkNode("taskA", "generic-prompt", { referenceAssignments: analysis.assignments, body: analysis.body }),
    ...Object.entries(assignments).map(([id, record]) => mkNode(id, `${record.kind}-reference`))
  ];
  const edges = Object.keys(assignments).map((id) => edge(id, "taskA"));
  check("normalization keeps the selected image role", normalize(nodes, edges, "taskA").target, analysis.assignments.target);

  const withNewImage = {
    ...analysis.assignments,
    newImage: { kind: "image", alias: "@图1", purpose: "", order: 5 }
  };
  const restored = updateTaskReferenceRole(withNewImage, analysis.body, "target", false);
  check("restored image skips occupied slots 1 and 2", restored.assignments.target,
    { ...assignments.target, alias: "@图3", analysisOnly: false, analysisOnlyManual: true });
  check("restoring a reference never inserts body tokens", restored.body, undefined);
  check("all other aliases and metadata remain unchanged",
    Object.entries(restored.assignments).filter(([id]) => id !== "target"),
    Object.entries(withNewImage).filter(([id]) => id !== "target"));
  const repeated = updateTaskReferenceRole(restored.assignments, analysis.body, "target", false);
  check("repeating a manual role is an allocation no-op", repeated.assignments === restored.assignments, true);
  check("missing material is a no-op", updateTaskReferenceRole(assignments, body, "missing", true).assignments === assignments, true);
}

console.log("\n[12] Persisted image analysis roles survive reload and stay task-local");
{
  for (const manual of [undefined, true]) {
    const assignments = {
      target: { kind: "image", alias: "@图1", purpose: "layout", order: 1, analysisOnly: true,
        ...(manual === undefined ? {} : { analysisOnlyManual: manual }) },
      selfie: { kind: "image", alias: "@图10", purpose: "identity", order: 2 }
    };
    const nodes = [
      mkNode("taskA", "generic-prompt", { referenceAssignments: assignments, body: "@图1 对比 @图10" }),
      mkNode("taskB", "task"),
      mkNode("target", "image-reference"),
      mkNode("selfie", "image-reference"),
      mkNode("newImage", "image-reference")
    ];
    const edges = [edge("target", "taskA"), edge("selfie", "taskA"), edge("newImage", "taskA"), edge("target", "taskB")];
    const result = normalizeFull(nodes, edges, "taskA");
    check(`manual=${manual}: clears stale alias while keeping analysis role`, result.assignments.target,
      { ...assignments.target, alias: "" });
    check(`manual=${manual}: clears only the analysis image's body token`, result.body, " 对比 @图10");
    check(`manual=${manual}: selfie is not inferred to be analysis-only`, result.assignments.selfie, assignments.selfie);
    check(`manual=${manual}: new image takes freed slot without renumbering selfie`, result.assignments.newImage.alias, "@图1");
    check(`manual=${manual}: same image is still numbered in another task`, normalize(nodes, edges, "taskB").target.alias, "@图1");
    nodes[0].data.referenceAssignments = result.assignments;
    nodes[0].data.body = result.body;
    const second = normalizeFull(nodes, edges, "taskA");
    check(`manual=${manual}: repeated normalization preserves record identity`, second.assignments === result.assignments, true);
    check(`manual=${manual}: repeated normalization leaves body alone`, second.body, undefined);
  }
}

console.log("\n[13] Manual numbered choices override generic-prompt video topology in payloads");
{
  const assignments = {
    target: { kind: "video", alias: "", purpose: "motion", order: 1, analysisOnly: true },
    other: { kind: "video", alias: "@视频1", purpose: "", order: 2, analysisOnly: false, analysisOnlyManual: true }
  };
  const restored = updateTaskReferenceRole(assignments, "unchanged", "target", false, true);
  check("manual video restoration takes free @视频2", restored.assignments.target.alias, "@视频2");
  const nodes = [mkNode("taskA", "generic-prompt", { referenceAssignments: restored.assignments }),
    mkNode("target", "video-reference"), mkNode("other", "video-reference")];
  const edges = [edge("target", "taskA"), edge("other", "taskA")];
  check("manual numbering survives topology normalization", normalize(nodes, edges, "taskA") === restored.assignments, true);
  for (const language of ["zh", "en"]) {
    const md = buildMarkdown(nodes, edges, "taskA", "node", "NOT-RUN", "/tmp/not-run", language).markdown;
    check(`${language}: manually numbered video has its chosen alias`, md.includes("- @视频2 · target"), true);
    check(`${language}: manual marker is not mistaken for analysis role`, /analysis source|分析源/.test(md), false);
  }
  const pinned = updateTaskReferenceRole(assignments, "unchanged", "target", true);
  check("explicitly choosing current auto role pins that role", pinned.assignments.target.analysisOnlyManual, true);
  const ordinaryTask = mkNode("taskA", "task", { referenceAssignments: pinned.assignments });
  check("pinned analysis choice survives removing auto topology", normalize([ordinaryTask, ...nodes.slice(1)], edges, "taskA").target.analysisOnly, true);
}

console.log("\n[14] NOT-RUN reusable-template demo: task-local image/video Markdown payloads");
{
  const attachment = (id, kind) => ({ id, kind, originalName: `${id}.${kind === "image" ? "png" : "mp4"}`,
    storedPath: `/tmp/not-run/.scatter/assets/${id}`, relativePath: `.scatter/assets/${id}`,
    fileUrl: `file:///tmp/not-run/.scatter/assets/${id}` });
  const nodes = [
    mkNode("photoPrompt", "generic-prompt", { genericPromptText: "NOT-RUN: reusable prompt for @图1", referenceAssignments: {
      targetImage: { kind: "image", alias: "@图7", purpose: "Analyze scene; do not use for generation", order: 1, analysisOnly: true, analysisOnlyManual: true },
      targetVideo: { kind: "video", alias: "", purpose: "Analyze motion only", order: 2, analysisOnly: true, analysisOnlyManual: true },
      selfie: { kind: "image", alias: "@图1", purpose: "Identity", order: 3, analysisOnly: false, analysisOnlyManual: true }
    }}),
    mkNode("otherTask", "task", { referenceAssignments: {
      targetImage: { kind: "image", alias: "@图8", purpose: "Generation reference", order: 1, analysisOnly: false, analysisOnlyManual: true }
    }}),
    mkNode("generation", "seedance-generation"),
    mkNode("targetImage", "image-reference", { attachments: [attachment("targetImage", "image")] }),
    mkNode("targetVideo", "video-reference", { attachments: [attachment("targetVideo", "video")] }),
    mkNode("selfie", "image-reference", { attachments: [attachment("selfie", "image")] })
  ];
  const edges = [edge("targetImage", "photoPrompt"), edge("targetVideo", "photoPrompt"), edge("selfie", "photoPrompt"),
    edge("targetImage", "otherTask"), edge("photoPrompt", "generation")];
  for (const language of ["zh", "en"]) {
    const label = language === "zh" ? "任务指定分析源（不编号，不作为生成参考）"
      : "Task-specified analysis source (no alias, not a generation reference)";
    for (const mode of ["node", "flow"]) {
      const result = buildMarkdown(nodes, edges, "photoPrompt", mode, "NOT-RUN", "/tmp/not-run", language);
      const prefix = `${language}/${mode}`;
      check(`${prefix}: image listed for analysis without a generation alias`, result.markdown.includes(`- ${label} · targetImage.png`), true);
      check(`${prefix}: video retains analysis-only semantics`, result.markdown.includes(`- ${label} · targetVideo.mp4`), true);
      check(`${prefix}: analysis image edge is unnumbered`, result.markdown.includes(`targetImage -> photoPrompt [${label}]`), true);
      check(`${prefix}: stale and other-task image aliases never leak`, /@图[78]/.test(result.markdown), false);
      check(`${prefix}: numbered selfie stays usable`, result.markdown.includes("- @图1 · selfie.png"), true);
      check(`${prefix}: analysis files remain accessible for inspection`, result.attachments.map((item) => item.id).sort(), ["selfie", "targetImage", "targetVideo"]);
      check(`${prefix}: image inspection paths are retained`, result.imagePaths.includes("/tmp/not-run/.scatter/assets/targetImage"), true);
      check(`${prefix}: downstream task included only in flow`, result.nodes.some((node) => node.id === "generation"), mode === "flow");
    }
    const other = buildMarkdown(nodes, edges, "otherTask", "node", "NOT-RUN", "/tmp/not-run", language);
    check(`${language}: same image can be numbered in a different task`, other.markdown.includes("- @图8 · targetImage.png"), true);
    check(`${language}: analysis role does not leak to other task`, other.markdown.includes(label), false);
    const generation = buildMarkdown(nodes, edges, "generation", "node", "NOT-RUN", "/tmp/not-run", language);
    check(`${language}: generation receives confirmed prompt text`, generation.markdown.includes("NOT-RUN: reusable prompt for @图1"), true);
    check(`${language}: upstream analysis media do not become generation inputs`, generation.attachments, []);
    check(`${language}: upstream analysis files absent from generation payload`, /targetImage|targetVideo/.test(generation.markdown), false);
  }
}

console.log("\n[15] PixVerse input filtering keeps target-analysis videos out by default");
check("analysis-only video is filtered", canUseGenerationMedia({ kind: "video", alias: "", purpose: "target", order: 0, analysisOnly: true }, true, true, false), false);
check("video used by analysis cannot leak into generation", canUseGenerationMedia(undefined, true, true, false), false);
check("target analysis video cannot be promoted to a generation reference", canUseGenerationMedia({ kind: "video", alias: "@视频2", purpose: "reference", order: 1, analysisOnly: false, analysisOnlyManual: true }, true, true, false), false);
check("explicitly connected depth output is allowed", canUseGenerationMedia({ kind: "video", alias: "@视频1", purpose: "depth", order: 0 }, true, true, true), true);
check("template video generation rejects non-depth video references", canUseGenerationMedia(undefined, true, false, false, true), false);
check("template video generation accepts an explicitly connected depth output", canUseGenerationMedia(undefined, true, false, true, true), true);
check("ordinary non-template video generation keeps normal video inputs", canUseGenerationMedia(undefined, true, false, false), true);
check("photo references remain available for image generation", canUseGenerationMedia({ kind: "image", alias: "@图2", purpose: "target photo", order: 1 }, false, true, false), true);
check("photo/video prompt connections cannot cross modes", isReplicationPipelineCompatible("photo", "video"), false);
check("nodes from different analysis loops cannot be combined", isReplicationPipelineCompatible("video", "video", "analysis-a", "analysis-b"), false);
check("same mode and analysis loop may connect", isReplicationPipelineCompatible("video", "video", "analysis-a", "analysis-a"), true);
check("scoped generator requires prompt from the same analysis", isReplicationPromptCompatible("video", "video", "analysis-a", "analysis-a"), true);
check("scoped generator rejects unscoped prompt", isReplicationPromptCompatible("video", "video", undefined, "analysis-a"), false);
check("scoped generator rejects prompt from another analysis", isReplicationPromptCompatible("video", "video", "analysis-b", "analysis-a"), false);
check("unscoped generator can adopt one scoped prompt loop", isReplicationPromptCompatible("photo", "photo", "analysis-a", undefined), true);

console.log("\n[16] PixVerse node defaults videos shared with analysis to analysis-only");
{
  const nodes = [
    mkNode("pixverse", "pixverse-generation"),
    mkNode("analysis", "replication-analysis"),
    mkNode("target", "video-reference"),
    mkNode("depth", "depth-conversion", { depthOutputNodeId: "depthOut" }),
    mkNode("depthOut", "video-reference")
  ];
  const edges = [edge("target", "analysis"), edge("target", "pixverse"), edge("depth", "depthOut"), edge("depthOut", "pixverse")];
  const assignments = normalize(nodes, edges, "pixverse");
  check("analysis-source target video gets no @video alias", assignments.target, {
    kind: "video", alias: "", purpose: "", order: 1, analysisOnly: true
  });
  check("explicit depth output gets @video1", assignments.depthOut, {
    kind: "video", alias: "@视频1", purpose: "", order: 2
  });
  check("PixVerse topology marks target as auto analysis-only", [...autoAnalysisSourceIdsForTask(nodes, edges, "pixverse")], ["target"]);
  check("target video is classified as analysis-only source", [...targetAnalysisVideoIds(nodes, edges)], ["target"]);
}

console.log("\n[17] A target video is excluded from generation even if manually numbered");
{
  const attachment = { id: "targetVideo", kind: "video", originalName: "target.mp4", storedPath: "/tmp/target.mp4", relativePath: "target.mp4", fileUrl: "file:///tmp/target.mp4" };
  const nodes = [
    mkNode("analysis", "replication-analysis", { replicationMode: "video" }),
    mkNode("targetVideo", "video-reference", { attachments: [attachment] }),
    mkNode("generation", "pixverse-generation", { replicationMode: "video", replicationAnalysisNodeId: "analysis", referenceAssignments: {
      targetVideo: { kind: "video", alias: "@视频1", purpose: "user override", order: 1, analysisOnly: false, analysisOnlyManual: true }
    } })
  ];
  const edges = [edge("targetVideo", "analysis"), edge("targetVideo", "generation")];
  const result = buildMarkdown(nodes, edges, "generation", "node", "NOT-RUN", "/tmp/not-run", "zh");
  check("target analysis video does not appear as a generation reference", !result.markdown.includes("targetVideo.mp4") && !result.markdown.includes("@视频1"), true);
  check("target analysis video is excluded from the generation attachment payload", result.attachments.map((item) => item.id), []);
}

console.log("\n[18] Video analysis scopes stay granular, unique, and non-duplicative");
{
  const parsed = parseReplicationSections(JSON.stringify({
    summary: "video overview",
    scopes: [
      { key: "overall", kind: "video", name: "Video", timeRange: "", categories: [{ id: "basic", content: "9:16, 24fps" }] },
      { key: "overall-duplicate", kind: "video", name: "Video duplicate", timeRange: "", categories: [{ id: "soundtrack", content: "music" }] },
      { key: "person", kind: "role", name: "Character A", timeRange: "", categories: [{ id: "identity", content: "red coat" }] },
      { key: "person", kind: "role", name: "Character B", timeRange: "", categories: [{ id: "identity", content: "blue coat" }] },
      { key: "shot-1", kind: "segment", name: "Segment 1", timeRange: "00:00.000–00:02.000", categories: [{ id: "action", content: "walks" }] },
      { key: "wrong-mode", kind: "photo", name: "Ignored photo", timeRange: "", categories: [{ id: "scene", content: "room" }] }
    ]
  }));
  check("parser accepts the video-global scope kind", parsed?.scopes.some((scope) => scope.kind === "video"), true);
  const scopes = normalizeReplicationScopes(parsed?.scopes || [], "video");
  check("normalization keeps one video-global group", scopes.filter((scope) => scope.kind === "video").length, 1);
  check("duplicate stable keys are retained with a unique suffix", scopes.filter((scope) => scope.kind === "role").map((scope) => scope.key), ["person", "person-2"]);
  check("second video-global group contributes its distinct category", scopes.find((scope) => scope.kind === "video")?.categories.get("soundtrack"), "music");
  check("photo scopes do not leak into the video pipeline", scopes.some((scope) => scope.kind === "photo"), false);
  check("role groups contain stable character facts rather than time-specific motion", replicationScopeSectionSpecs.role.map((spec) => spec.id).some((id) => ["action", "screen-position", "expression", "owned-props"].includes(id)), false);
}

console.log("\n[19] Video analysis requires complete, consecutive, frame-readable time segments");
{
  const scope = (timeRange) => ({ key: timeRange, kind: "segment", name: "segment", timeRange, categories: new Map() });
  check("continuous timeline starts at zero and has no gaps", hasContinuousVideoSegmentCoverage([
    scope("00:00.000–00:02.500"), scope("00:02.500–00:04.000")
  ], 4000), true);
  check("timeline is not accepted when source duration is unknown", hasContinuousVideoSegmentCoverage([
    scope("00:00.000–00:02.500"), scope("00:02.500–00:04.000")
  ]), false);
  check("timeline end matches the measured source-video duration", hasContinuousVideoSegmentCoverage([
    scope("00:00.000–00:02.500"), scope("00:02.500–00:04.000")
  ], 4000), true);
  check("timeline must reach the measured source-video end", hasContinuousVideoSegmentCoverage([
    scope("00:00.000–00:02.500"), scope("00:02.500–00:03.900")
  ], 4000), false);
  check("timeline rejects a missing first segment", hasContinuousVideoSegmentCoverage([scope("00:01.000–00:04.000")]), false);
  check("timeline rejects gaps", hasContinuousVideoSegmentCoverage([
    scope("00:00.000–00:02.000"), scope("00:02.100–00:04.000")
  ], 4000), false);
  check("timeline rejects overlaps", hasContinuousVideoSegmentCoverage([
    scope("00:00.000–00:02.100"), scope("00:02.000–00:04.000")
  ], 4000), false);
  check("timeline rejects malformed or reversed timecodes", hasContinuousVideoSegmentCoverage([
    scope("00:00.000–00:04.000"), scope("00:04.000–00:03.000")
  ]), false);
  check("video analysis rejects a missing segment group", hasContinuousVideoSegmentCoverage([]), false);
}

console.log("\n[20] Stale and cross-loop categories never enter prompt context");
{
  const photoSection = mkNode("photoSection", "replication-section", {
    title: "PHOTO_ONLY_CATEGORY", body: "PHOTO_ONLY_CONTENT", replicationMode: "photo", replicationAnalysisNodeId: "photoAnalysis"
  });
  const staleSection = mkNode("staleSection", "replication-section", {
    title: "STALE_CATEGORY", body: "STALE_CONTENT", replicationMode: "video", replicationAnalysisNodeId: "videoAnalysis", replicationScopeStale: true
  });
  const prompt = mkNode("videoPrompt", "generic-prompt", {
    title: "video prompt", replicationMode: "video", replicationAnalysisNodeId: "videoAnalysis", genericPromptText: ""
  });
  const nodes = [photoSection, staleSection, prompt];
  const edges = [edge(photoSection.id, prompt.id), edge(staleSection.id, prompt.id)];
  const result = buildMarkdown(nodes, edges, prompt.id, "node", "NOT-RUN", "/tmp/not-run", "zh");
  check("stale categories are excluded from prompt context", result.markdown.includes("STALE_CONTENT"), false);
  check("categories from another photo/video loop are excluded", result.markdown.includes("PHOTO_ONLY_CONTENT"), false);
}

console.log("\n[21] Only depth output can be a video-generation reference in the video-replication loop");
{
  const attachment = { id: "ordinaryVideo", kind: "video", originalName: "ordinary.mp4", storedPath: "/tmp/ordinary.mp4", relativePath: "ordinary.mp4", fileUrl: "file:///tmp/ordinary.mp4" };
  const ordinaryVideo = mkNode("ordinaryVideo", "video-reference", { attachments: [attachment] });
  const prompt = mkNode("prompt", "generic-prompt", { replicationMode: "video", replicationAnalysisNodeId: "analysis", genericPromptText: "approved prompt" });
  const generator = mkNode("generator", "pixverse-generation", { replicationMode: "video", replicationAnalysisNodeId: "analysis", pixverseMode: "video" });
  const nodes = [ordinaryVideo, prompt, generator];
  const edges = [edge(prompt.id, generator.id), edge(ordinaryVideo.id, generator.id)];
  const result = buildMarkdown(nodes, edges, generator.id, "node", "NOT-RUN", "/tmp/not-run", "zh");
  check("non-depth video is absent from the scoped generation reference list", result.markdown.includes("ordinary.mp4"), false);
  check("non-depth video is absent from the scoped generation attachment payload", result.attachments.some((item) => item.id === "ordinaryVideo"), false);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
