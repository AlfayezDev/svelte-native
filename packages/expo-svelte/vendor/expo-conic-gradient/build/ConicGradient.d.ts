import { Component, ReactNode } from "react";
import { ViewProps } from "react-native";
import { CenterPoint, NativeConicGradientViewProps } from "./NativeConicGradient.types";
type ConicGradientProps = ViewProps & Omit<NativeConicGradientViewProps, "colors"> & {
    colors: [string, string, ...string[]];
    center?: CenterPoint;
};
export default class ConicGradient extends Component<ConicGradientProps> {
    render(): ReactNode;
}
export {};
//# sourceMappingURL=ConicGradient.d.ts.map