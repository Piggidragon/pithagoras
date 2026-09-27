/**
 * Where the portal keeps its database and what belongs with it.
 *
 * A module of its own so the entry can lock it before anything that opens the
 * database is loaded.
 */
export const DATA_DIR = process.env.DATA_DIR || "./data";
