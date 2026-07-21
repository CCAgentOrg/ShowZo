import { BrowserRouter, Route, Routes } from "react-router-dom";
import BlankDemo from "./pages/blank-demo";
import DesignKitDemo from "./pages/_design";
import ShowZoPage from "./pages/showzo";
import { ThemeProvider } from "@/components/theme-provider";

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/_design" element={<DesignKitDemo />} />
          <Route path="/showzo" element={<ShowZoPage />} />
          <Route path="/" element={<BlankDemo />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
