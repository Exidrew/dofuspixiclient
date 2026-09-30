#!/usr/bin/env node
/**
 * Codec et helpers de maps Dofus 1.29 pour `dofuspixiclient`.
 *
 * Ce module est AUTONOME : il ne lit rien à l'extérieur du projet. Il fournit
 * le décodage/encodage du format de cellules `HASH_CELL` (10 caractères par
 * cellule) partagé par le client Dofus 1.29 et le serveur, ainsi que la
 * géométrie de la grille.
 *
 * Le format `HASH_CELL` est l'inverse exact de
 * `apps/gameserver-ts/src/core/modules/maps/maps.cells-codec.ts` (lui-même port
 * de `apps/gameserver/pkg/exploration/domain/cells_decoder.go`). La conversion
 * entre un payload source et le champ `cells` (bytea) est donc une simple copie
 * d'octets — les cellules gardent leurs identifiants et leurs positions.
 *
 * Ce module expose :
 *   - unpack60(raw, offset)      → bits 60 d'une cellule (interne, export pour tests)
 *   - pack60(plan60)             → 10 chars HASH_CELL (inverse exact d'unpack60)
 *   - decodeHashCells(mapData)   → BigInt[] des cellules d'un payload
 *   - encodeHashCells(plans)     → chaîne HASH_CELL
 *   - cellsCountOf(width, height)
 *   - findDims(count, preferredWidth)
 *   - extractMapGeometry(entry)
 */

const HASH_CELL =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";

const HASH_CELL_INDEX = (() => {
  const t = new Int8Array(256).fill(-1);
  for (let i = 0; i < HASH_CELL.length; i++) {
    t[HASH_CELL.charCodeAt(i)] = i;
  }
  return t;
})();

export const CELL_CHAR_LEN = 10;

/**
 * Décode une cellule (10 chars HASH_CELL) vers le champ 60 bits intermédiaire,
 * exactement comme `unpack60` de maps.cells-codec.ts.
 */
export function unpack60(raw, offset) {
  const d = [];
  for (let i = 0; i < CELL_CHAR_LEN; i++) {
    const b = raw[offset + i];
    const idx = HASH_CELL_INDEX[b];
    if (idx < 0) {
      throw new Error(`dofus-maps: HASH_CELL invalide (byte ${b})`);
    }
    d.push(BigInt(idx));
  }
  const [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9] = d;

  const active = (d0 & 0x20n) >> 5n;
  const lineOfSight = d0 & 0x1n;
  const movement = (d2 & 0x38n) >> 3n;
  const groundLevel = d1 & 0xfn;
  const groundSlope = (d4 & 0x3cn) >> 2n;
  const groundNum = ((d0 & 0x18n) << 6n) | ((d2 & 0x7n) << 6n) | (d3 & 0x3fn);
  const groundFlip = (d4 & 0x2n) >> 1n;
  const groundRot = (d1 & 0x30n) >> 4n;
  const obj1Num =
    ((d0 & 0x4n) << 11n) |
    ((d4 & 0x1n) << 12n) |
    ((d5 & 0x3fn) << 6n) |
    (d6 & 0x3fn);
  const obj1Flip = (d7 & 0x8n) >> 3n;
  const obj1Rot = (d7 & 0x30n) >> 4n;
  const obj2Num =
    ((d0 & 0x2n) << 12n) |
    ((d7 & 0x1n) << 12n) |
    ((d8 & 0x3fn) << 6n) |
    (d9 & 0x3fn);
  const obj2Flip = (d7 & 0x4n) >> 2n;
  const obj2Interactive = (d7 & 0x2n) >> 1n;

  let r = 0n;
  r = (r << 1n) | obj2Interactive;
  r = (r << 1n) | obj2Flip;
  r = (r << 14n) | obj2Num;
  r = (r << 2n) | obj1Rot;
  r = (r << 1n) | obj1Flip;
  r = (r << 14n) | obj1Num;
  r = (r << 2n) | groundRot;
  r = (r << 1n) | groundFlip;
  r = (r << 11n) | groundNum;
  r = (r << 4n) | groundSlope;
  r = (r << 4n) | groundLevel;
  r = (r << 3n) | movement;
  r = (r << 1n) | lineOfSight;
  r = (r << 1n) | active;
  return r;
}

/** Inverse exact de unpack60 (sert au re-pack / au forçage de cellule). */
export function pack60(p) {
  const a_ = p & 0x1n;
  let r = p >> 1n;
  const l_ = r & 0x1n;
  r >>= 1n;
  const m_ = r & 0x7n;
  r >>= 3n;
  const gl_ = r & 0xfn;
  r >>= 4n;
  const gs_ = r & 0xfn;
  r >>= 4n;
  const gn_ = r & 0x7ffn;
  r >>= 11n;
  const gf_ = r & 0x1n;
  r >>= 1n;
  const gr_ = r & 0x3n;
  r >>= 2n;
  const o1_ = r & 0x3fffn;
  r >>= 14n;
  const o1f_ = r & 0x1n;
  r >>= 1n;
  const o1r_ = r & 0x3n;
  r >>= 2n;
  const o2_ = r & 0x3fffn;
  r >>= 14n;
  const o2f_ = r & 0x1n;
  r >>= 1n;
  const o2i_ = r & 0x1n;

  const d = new Array(10);
  d[0] = Number(
    ((gn_ >> 6n) & 0x18n) |
      (a_ << 5n) |
      l_ |
      ((o1_ >> 11n) & 0x4n) |
      ((o2_ >> 12n) & 0x2n)
  );
  d[1] = Number(gl_ | (gr_ << 4n));
  d[2] = Number((m_ << 3n) | ((gn_ >> 6n) & 0x7n));
  d[3] = Number(gn_ & 0x3fn);
  d[4] = Number((gs_ << 2n) | (gf_ << 1n) | ((o1_ >> 12n) & 0x1n));
  d[5] = Number((o1_ >> 6n) & 0x3fn);
  d[6] = Number(o1_ & 0x3fn);
  d[7] = Number(
    (o1r_ << 4n) |
      (o1f_ << 3n) |
      (o2f_ << 2n) |
      (o2i_ << 1n) |
      ((o2_ >> 12n) & 0x1n)
  );
  d[8] = Number((o2_ >> 6n) & 0x3fn);
  d[9] = Number(o2_ & 0x3fn);
  return d.map((v) => HASH_CELL[v & 0x3f]).join("");
}

/** Décode un payload HASH_CELL complet en tableau de plans 60 bits. */
export function decodeHashCells(mapData) {
  const raw = Buffer.from(mapData, "ascii");
  if (raw.length % CELL_CHAR_LEN !== 0) {
    throw new Error(
      `dofus-maps: payload ${raw.length} n'est pas multiple de ${CELL_CHAR_LEN}`
    );
  }
  const count = raw.length / CELL_CHAR_LEN;
  const cells = new Array(count);
  for (let i = 0; i < count; i++) {
    cells[i] = unpack60(raw, i * CELL_CHAR_LEN);
  }
  return cells;
}

/** Encode un tableau de plans 60 bits en payload HASH_CELL. */
export function encodeHashCells(plans) {
  return plans.map((p) => pack60(p)).join("");
}

/**
 * Nombre de cellules d'une map Dofus 1.29.
 *
 * Convention CANONIQUE (client `@dofus/grid` `totalCells`) :
 *
 *     cells = width * height + (width - 1) * (height - 1)
 *
 * où `width`  = nombre de cellules d'une ligne "longue"
 *    `height` = nombre de PAIRES de lignes (et NON le nombre de lignes
 *               alternees 2*height-1).
 *
 * Piege : la formule ceil(H/2)*W + floor(H/2)*(W-1) donne le MEME compte pour H
 * et 2*H-1 (ex. 15x17 et 15x33 donnent tous deux 479). Mais les geometries sont
 * differentes : le client utilise totalCells(width,height) et
 * DEFAULT_MAP_HEIGHT = 17 -> donc height DOIT rester 17. Ecrire 33 double la
 * hauteur logique, ce qui fait deborder computeMapScale() (offsetY negatif) et
 * decale toute la carte vers le haut.
 */
export function cellsCountOf(width, height) {
  return width * height + (width - 1) * (height - 1);
}

/**
 * Trouve (width, height) produisant `count` cellules. On privilegie une largeur
 * proche du defaut client (15).
 *
 * `cellsCountOf` etant strictement croissante, la decomposition est unique une
 * fois `width` fixe : on itere sur les largeurs et on resout la hauteur
 * directement (count = (2w-1)h - (w-1)  =>  h = (count + w - 1) / (2w - 1)).
 */
export function findDims(count, preferredWidth = 15) {
  const candidates = [];
  for (let w = 2; w <= 300; w++) {
    const denom = 2 * w - 1;
    const num = count + w - 1;
    if (num % denom !== 0) {
      continue;
    }
    const h = num / denom;
    if (h >= 2 && Number.isInteger(h)) {
      candidates.push({ width: w, height: h });
    }
  }
  if (candidates.length > 500) {
    throw new Error("findDims: trop de candidats, dimension dégénérée");
  }
  // Priorite : la largeur EXACTEMENT egale au defaut client (15). Sinon on
  // reste proche de 15 mais on ne descend jamais sous 8 (une map Dofus ne fait
  // jamais 3 de large) pour ne pas choisir une geometrie degeneree 3x192.
  candidates.sort((a, b) => {
    const aExact = a.width === preferredWidth ? 0 : 1;
    const bExact = b.width === preferredWidth ? 0 : 1;
    if (aExact !== bExact) {
      return aExact - bExact;
    }
    const sane = (d) => d.width >= 8 && d.height >= 5;
    const aDelta = sane(a)
      ? Math.abs(a.width - preferredWidth)
      : 1000 + Math.abs(a.width - preferredWidth);
    const bDelta = sane(b)
      ? Math.abs(b.width - preferredWidth)
      : 1000 + Math.abs(b.width - preferredWidth);
    return aDelta - bDelta;
  });
  return candidates[0];
}

/**
 * Géométrie dofuspixiclient (width = cellules d'une ligne longue, height = paires
 * de lignes) pour une entrée de map figée.
 *
 * On fait d'abord confiance aux dimensions DÉCLARÉES (`width`/`height`) quand
 * elles expliquent exactement le nombre de cellules du payload — c'est la source
 * la plus fiable et elle conserve l'orientation voulue. Sinon on retombe sur
 * `findDims`, qui reconstruit la geometrie a partir du seul compte de cellules.
 *
 * Une map Dofus a toujours une largeur >= 8 et une hauteur >= 5 : une geometrie
 * degeneree (ex. 3x192, seule decomposition de 958 = 2x479) signale un payload
 * anormal (map dupliquee) — on refuse plutot que d'inserer une map absurde.
 *
 * @param {{width?:number,height?:number,mapData:string}} entry
 */
export function extractMapGeometry(entry) {
  const count = entry.mapData.length / CELL_CHAR_LEN;

  const declaredWidth = entry.width;
  const declaredHeight = entry.height;
  if (
    declaredWidth &&
    declaredHeight &&
    cellsCountOf(declaredWidth, declaredHeight) === count
  ) {
    return { width: declaredWidth, height: declaredHeight, count };
  }

  const dims = findDims(count, declaredWidth || 15);
  if (!dims || dims.width < 8 || dims.height < 5) {
    throw new Error(
      `dofus-maps: ${count} cellules, aucune geometrie Dofus plausible` +
        (dims ? ` (meilleure: ${dims.width}x${dims.height})` : "")
    );
  }
  return { ...dims, count };
}

/** Force des cellules a etre actives et marchables (movement=1). */
export function forceWalkable(plans, cellIds) {
  for (const id of cellIds) {
    if (id >= 0 && id < plans.length) {
      let p = plans[id];
      p |= 0x1n; // active
      p &= ~(0x7n << 2n);
      p |= 1n << 2n; // movement = 1
      plans[id] = p;
    }
  }
}

export { HASH_CELL };
