import FlatbushDefault from "flatbush";

type FlatbushConstructor = typeof FlatbushDefault;
type FlatbushModuleShape = {
  readonly default?: unknown;
};

export type TerritoryFlatbush = InstanceType<FlatbushConstructor>;

export const Flatbush: FlatbushConstructor = resolveFlatbushConstructor(FlatbushDefault);

function resolveFlatbushConstructor(candidate: unknown): FlatbushConstructor {
  if (typeof candidate === "function") {
    return candidate as FlatbushConstructor;
  }

  if (
    candidate &&
    typeof candidate === "object" &&
    typeof (candidate as FlatbushModuleShape).default === "function"
  ) {
    return (candidate as { readonly default: FlatbushConstructor }).default;
  }

  throw new TypeError("Unable to resolve the Flatbush constructor.");
}
