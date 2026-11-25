import type { CommitItem } from "../../bindings/gitpulse/internal/git/models";

export interface GraphEdge {
  fromLane: number;
  toLane: number;
  color: string;
  direction: "in" | "out" | "pass";
}

export interface GraphRowLayout {
  lane: number;
  color: string;
  edges: GraphEdge[];
  maxLanes: number;
}

const LANE_COLORS = [
  "#0284c7", // primary blue
  "#7c3aed", // violet
  "#16a34a", // green
  "#ea580c", // orange
  "#0891b2", // cyan
  "#db2777", // pink
  "#4f46e5", // indigo
];

export function computeCommitGraph(commits: CommitItem[]): GraphRowLayout[] {
  const lanes: (string | null)[] = [];
  const laneColors: string[] = [];
  let nextColorIdx = 0;

  const allocColor = () => {
    const c = LANE_COLORS[nextColorIdx % LANE_COLORS.length];
    nextColorIdx++;
    return c;
  };

  const results: GraphRowLayout[] = [];

  for (const commit of commits) {
    const hash = commit.hash;
    const parents = commit.parents ?? [];

    // Find all lanes currently waiting for this commit
    const matchingLanes: number[] = [];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === hash) {
        matchingLanes.push(i);
      }
    }

    let nodeLane: number;
    let nodeColor: string;
    const edges: GraphEdge[] = [];

    if (matchingLanes.length > 0) {
      nodeLane = matchingLanes[0];
      nodeColor = laneColors[nodeLane] || allocColor();
      // Incoming lines from top into nodeLane
      for (const ml of matchingLanes) {
        edges.push({
          fromLane: ml,
          toLane: nodeLane,
          color: laneColors[ml] || nodeColor,
          direction: "in",
        });
        if (ml !== nodeLane) {
          lanes[ml] = null;
        }
      }
    } else {
      const freeIdx = lanes.indexOf(null);
      if (freeIdx >= 0) {
        nodeLane = freeIdx;
      } else {
        nodeLane = lanes.length;
        lanes.push(null);
        laneColors.push("");
      }
      nodeColor = allocColor();
      laneColors[nodeLane] = nodeColor;
    }

    // Pass-through lanes for all OTHER active lanes
    for (let i = 0; i < lanes.length; i++) {
      if (i !== nodeLane && lanes[i] !== null) {
        edges.push({
          fromLane: i,
          toLane: i,
          color: laneColors[i] || LANE_COLORS[0],
          direction: "pass",
        });
      }
    }

    // Assign parents outgoing from nodeLane
    if (parents.length === 0) {
      lanes[nodeLane] = null;
    } else {
      // First parent continues on nodeLane unless already tracked elsewhere
      const p0 = parents[0];
      const existingP0 = lanes.indexOf(p0);
      if (existingP0 >= 0 && existingP0 !== nodeLane) {
        edges.push({
          fromLane: nodeLane,
          toLane: existingP0,
          color: nodeColor,
          direction: "out",
        });
        lanes[nodeLane] = null;
      } else {
        lanes[nodeLane] = p0;
        laneColors[nodeLane] = nodeColor;
        edges.push({
          fromLane: nodeLane,
          toLane: nodeLane,
          color: nodeColor,
          direction: "out",
        });
      }

      // Secondary parents (merges)
      for (let pi = 1; pi < parents.length; pi++) {
        const p = parents[pi];
        const existing = lanes.indexOf(p);
        if (existing >= 0) {
          edges.push({
            fromLane: nodeLane,
            toLane: existing,
            color: laneColors[existing] || allocColor(),
            direction: "out",
          });
        } else {
          const free = lanes.indexOf(null);
          const targetLane = free >= 0 ? free : lanes.length;
          if (targetLane === lanes.length) {
            lanes.push(p);
            laneColors.push(allocColor());
          } else {
            lanes[targetLane] = p;
            laneColors[targetLane] = allocColor();
          }
          edges.push({
            fromLane: nodeLane,
            toLane: targetLane,
            color: laneColors[targetLane],
            direction: "out",
          });
        }
      }
    }

    // Trim trailing null lanes to keep graph width compact
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
      laneColors.pop();
    }

    let maxLanes = nodeLane + 1;
    for (const e of edges) {
      if (e.fromLane + 1 > maxLanes) maxLanes = e.fromLane + 1;
      if (e.toLane + 1 > maxLanes) maxLanes = e.toLane + 1;
    }

    results.push({
      lane: nodeLane,
      color: nodeColor,
      edges,
      maxLanes,
    });
  }

  return results;
}
