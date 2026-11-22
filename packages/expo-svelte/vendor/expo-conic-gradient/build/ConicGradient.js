import { Component } from "react";
import { processColor } from "react-native";
import NativeConicGradientView from "./NativeConicGradientView";
export default class ConicGradient extends Component {
    render() {
        const { colors, locations, center, angle, ...props } = this.props;
        return (<NativeConicGradientView {...props} colors={colors.map(processColor)} locations={locations} center={center} angle={angle}/>);
    }
}
//# sourceMappingURL=ConicGradient.js.map