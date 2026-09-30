/**
 * Folders that tools fill with what they fetched or built: left out of a
 * folder's archive, and not looked through for git work when a folder is
 * deleted. Each can hold tens of thousands of folders, and none of it is the
 * work itself. One list, so that the two do not drift apart.
 */
export const GENERATED_DIRS = ["node_modules", "__pycache__", ".venv", "venv", ".tox", ".mypy_cache", ".cache", "dist", "build", "target", ".next", ".gradle"];
