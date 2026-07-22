import * as alphaTab from '@coderline/alphatab';

export interface SourceLocationRange {
    startLine: number; // 0-based for VS Code
    startCol: number;  // 0-based for VS Code
    endLine: number;   // 0-based for VS Code
    endCol: number;    // 0-based for VS Code
}

interface Location {
    line: number;
    col: number;
    offset?: number;
}

interface NodeWithLocation {
    start?: Location;
    end?: Location;
}

function getLocationRange(node: NodeWithLocation | null | undefined): SourceLocationRange | null {
    if (!node || !node.start || !node.end) {
        return null;
    }
    if (typeof node.start.line !== 'number' || typeof node.start.col !== 'number' ||
        typeof node.end.line !== 'number' || typeof node.end.col !== 'number') {
        return null;
    }
    return {
        startLine: Math.max(0, node.start.line - 1),
        startCol: Math.max(0, node.start.col - 1),
        endLine: Math.max(0, node.end.line - 1),
        endCol: Math.max(0, node.end.col - 1)
    };
}

export function resolveNotePosition(
    alphaTex: string,
    barIndex: number,
    beatIndex: number,
    noteIndex?: number
): SourceLocationRange | null {
    try {
        const parser = new alphaTab.importer.alphaTex.AlphaTexParser(alphaTex);
        const ast = parser.read();
        if (!ast || !ast.bars || barIndex < 0 || barIndex >= ast.bars.length) {
            return null;
        }

        const bar = ast.bars[barIndex];
        if (!bar) {
            return null;
        }

        if (beatIndex !== undefined && bar.beats && beatIndex >= 0 && beatIndex < bar.beats.length) {
            const beat = bar.beats[beatIndex];
            if (beat) {
                if (noteIndex !== undefined && beat.notes && Array.isArray(beat.notes.notes)) {
                    const notes = beat.notes.notes;
                    if (noteIndex >= 0 && noteIndex < notes.length) {
                        const note = notes[noteIndex];
                        const noteRange = getLocationRange(note);
                        if (noteRange) {
                            return noteRange;
                        }
                    }
                }
                const beatRange = getLocationRange(beat);
                if (beatRange) {
                    return beatRange;
                }
            }
        }

        return getLocationRange(bar);
    } catch {
        return null;
    }
}
