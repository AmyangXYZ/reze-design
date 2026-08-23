// Lets a script import reze-engine, whose dist uses extensionless relative
// imports. See resolve-ext.mjs.
import { register } from "node:module"

register("./resolve-ext.mjs", import.meta.url)
