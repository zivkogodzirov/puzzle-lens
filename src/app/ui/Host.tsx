/** The kit's app-wide layers, mounted once at the end of App: the toast and confirmAction()'s action sheet. */
import { ConfirmHost } from './ActionSheet';
import { ToastHost } from './ToastHost';

export function UiHost() {
  return (
    <>
      <ToastHost />
      <ConfirmHost />
    </>
  );
}
