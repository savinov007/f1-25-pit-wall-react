// The Pit Wall page. Every part subscribes to its own slice of the server state, so App itself never re-renders
// on a server message.
import {ComparePanel} from './components/compare/ComparePanel';
import {DriverPopup} from './components/driver/DriverPopup';
import {Header} from './components/header/Header';
import {Dashboard} from './components/layout/Dashboard';
import {LayoutDialog} from './components/layout/LayoutDialog';
import {Toast, useFormatWarning} from './components/overlays/Toast';
import {WaitScreen} from './components/overlays/WaitScreen';
import {ReplayControls} from './components/replay/ReplayControls';
import {ReplaysDialog} from './components/replay/ReplaysDialog';

function FormatWarning() {
  useFormatWarning();
  return null;
}

export function App() {
  return (
    <>
      <Header />
      <Dashboard />
      <DriverPopup />
      <ComparePanel />
      <LayoutDialog />
      <ReplaysDialog />
      <ReplayControls />
      <Toast />
      <WaitScreen />
      <FormatWarning />
    </>
  );
}
