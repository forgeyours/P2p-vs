export interface ParticipantInfo {
  id: string;
  isSpeaking: boolean;
}

export interface ActiveMedia {
  id: string;
  type: 'video' | 'image' | 'pdf';
  url: string;
  currentPage?: number;
}

export interface LayoutRect {
  id: string; // 'media' or participant's id
  x: number;  // percentage (0-100)
  y: number;  // percentage (0-100)
  w: number;  // percentage (0-100)
  h: number;  // percentage (0-100)
}

/**
 * Computes percentage-based positioning rects for a composited live layout.
 * Supports up to 4 participants and optionally a shared media block.
 * Uses orientation-specific rules to balance negative space.
 */
export function computeLayout(
  participants: ParticipantInfo[],
  activeMedia: ActiveMedia | null,
  orientation: 'landscape' | 'portrait'
): LayoutRect[] {
  const result: LayoutRect[] = [];

  // If there is active media sharing
  if (activeMedia) {
    if (orientation === 'landscape') {
      // Media is dominant on the left side
      result.push({
        id: 'media',
        x: 0,
        y: 0,
        w: 75,
        h: 100,
      });

      // Participants are in a vertical strip on the right
      const pCount = participants.length;
      if (pCount > 0) {
        const itemH = 100 / pCount;
        participants.forEach((p, idx) => {
          result.push({
            id: p.id,
            x: 75,
            y: idx * itemH,
            w: 25,
            h: itemH,
          });
        });
      }
    } else {
      // Portrait: Media is dominant on the top
      result.push({
        id: 'media',
        x: 0,
        y: 0,
        w: 100,
        h: 70,
      });

      // Participants are in a horizontal strip at the bottom
      const pCount = participants.length;
      if (pCount > 0) {
        const itemW = 100 / pCount;
        participants.forEach((p, idx) => {
          result.push({
            id: p.id,
            x: idx * itemW,
            y: 70,
            w: itemW,
            h: 30,
          });
        });
      }
    }
    return result;
  }

  // If no media sharing, layout participants
  const n = participants.length;
  if (n === 0) {
    return [];
  }

  if (n === 1) {
    // Single participant fullscreen
    result.push({
      id: participants[0].id,
      x: 0,
      y: 0,
      w: 100,
      h: 100,
    });
  } else if (n === 2) {
    if (orientation === 'landscape') {
      // Vertical split
      result.push({
        id: participants[0].id,
        x: 0,
        y: 0,
        w: 50,
        h: 100,
      });
      result.push({
        id: participants[1].id,
        x: 50,
        y: 0,
        w: 50,
        h: 100,
      });
    } else {
      // Horizontal split
      result.push({
        id: participants[0].id,
        x: 0,
        y: 0,
        w: 100,
        h: 50,
      });
      result.push({
        id: participants[1].id,
        x: 0,
        y: 50,
        w: 100,
        h: 50,
      });
    }
  } else if (n === 3) {
    if (orientation === 'landscape') {
      // Left side dominant, right side stacked
      result.push({
        id: participants[0].id,
        x: 0,
        y: 0,
        w: 50,
        h: 100,
      });
      result.push({
        id: participants[1].id,
        x: 50,
        y: 0,
        w: 50,
        h: 50,
      });
      result.push({
        id: participants[2].id,
        x: 50,
        y: 50,
        w: 50,
        h: 50,
      });
    } else {
      // Top side dominant, bottom side side-by-side
      result.push({
        id: participants[0].id,
        x: 0,
        y: 0,
        w: 100,
        h: 50,
      });
      result.push({
        id: participants[1].id,
        x: 0,
        y: 50,
        w: 50,
        h: 50,
      });
      result.push({
        id: participants[2].id,
        x: 50,
        y: 50,
        w: 50,
        h: 50,
      });
    }
  } else {
    // 4 participants: standard 2x2 grid
    result.push({
      id: participants[0].id,
      x: 0,
      y: 0,
      w: 50,
      h: 50,
    });
    result.push({
      id: participants[1].id,
      x: 50,
      y: 0,
      w: 50,
      h: 50,
    });
    result.push({
      id: participants[2].id,
      x: 0,
      y: 50,
      w: 50,
      h: 50,
    });
    result.push({
      id: participants[3].id,
      x: 50,
      y: 50,
      w: 50,
      h: 50,
    });
  }

  return result;
}
