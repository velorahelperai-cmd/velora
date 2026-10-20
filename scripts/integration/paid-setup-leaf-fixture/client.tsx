import React from "react";import {hydrateRoot} from "react-dom/client";import {Fixture,type Options} from "./fixture";
declare global {interface Window {__fixture:Options;}}
hydrateRoot(document.getElementById("root")!,<Fixture options={window.__fixture}/>);
