/**
 * ShowZo — Agentic Walkthrough Video Generator
 *
 * Embedded page within the Zo Site at /showzo.
 * Wraps the standalone ShowZo app with the site's base styles.
 * The app uses its own theme (zinc-based) independent of the site's theme.json.
 */
import ShowZoApp from "../showzo/App";

export default function ShowZoPage() {
  return (
    <div className="showzo-container">
      <ShowZoApp />
    </div>
  );
}
