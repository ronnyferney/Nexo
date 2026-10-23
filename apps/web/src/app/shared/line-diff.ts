/** Línea de un diff por líneas: igual, agregada o eliminada, con número en el texto original y en el nuevo. */
export interface DiffLine {
  kind: 'same' | 'add' | 'del';
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

/** Tamaño máximo de la tabla LCS; por encima se muestra todo el bloque central como reemplazado. */
const MAX_CELLS = 4_000_000;

/**
 * Diff por líneas basado en la subsecuencia común más larga (LCS), con recorte previo del prefijo y sufijo comunes.
 * Suficiente para comparar prompts y perfiles (decenas o cientos de líneas).
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ kind: 'same', text: a[i]!, oldNo: i + 1, newNo: i + 1 });

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  for (const op of diffMiddle(midA, midB)) {
    out.push({
      kind: op.kind,
      text: op.text,
      oldNo: op.i === null ? null : start + op.i + 1,
      newNo: op.j === null ? null : start + op.j + 1,
    });
  }

  for (let k = 0; endA + k < a.length; k++) {
    out.push({ kind: 'same', text: a[endA + k]!, oldNo: endA + k + 1, newNo: endB + k + 1 });
  }
  return out;
}

/** Cuenta de líneas agregadas y eliminadas. */
export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.kind === 'add') added++;
    else if (l.kind === 'del') removed++;
  }
  return { added, removed };
}

function splitLines(text: string): string[] {
  return text ? text.replace(/\r\n?/g, '\n').split('\n') : [];
}

interface Op {
  kind: DiffLine['kind'];
  text: string;
  i: number | null;
  j: number | null;
}

function diffMiddle(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  if (!n) return b.map((text, j) => ({ kind: 'add', text, i: null, j }));
  if (!m) return a.map((text, i) => ({ kind: 'del', text, i, j: null }));
  if (n * m > MAX_CELLS) {
    return [
      ...a.map((text, i): Op => ({ kind: 'del', text, i, j: null })),
      ...b.map((text, j): Op => ({ kind: 'add', text, i: null, j })),
    ];
  }

  // lcs[i][j] = longitud de la LCS de a[i..] y b[j..] (tabla plana para menos asignaciones).
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'same', text: a[i]!, i, j });
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) {
      ops.push({ kind: 'del', text: a[i]!, i, j: null });
      i++;
    } else {
      ops.push({ kind: 'add', text: b[j]!, i: null, j });
      j++;
    }
  }
  for (; i < n; i++) ops.push({ kind: 'del', text: a[i]!, i, j: null });
  for (; j < m; j++) ops.push({ kind: 'add', text: b[j]!, i: null, j });
  return ops;
}
