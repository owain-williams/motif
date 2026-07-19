import { registerRootComponent } from "expo";

// Defines the headless sync executor before native task restoration can invoke it.
import "./src/background-sync";
import App from "./App";

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately.
registerRootComponent(App);
