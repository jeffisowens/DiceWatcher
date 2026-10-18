import React from "react";
import ReactDOM from "react-dom/client";
import { Bench } from "./Bench";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element.");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <Bench />
  </React.StrictMode>
);
