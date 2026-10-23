package com.m3athrazaq.asfari;

import android.app.Activity;
import android.content.Context;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Prints the PDF report with Android's own print dialog (a printer, or "Save as PDF").
 *
 * print({ path, name }): path is the report the page has just written to the app's cache, under
 * exports/ (nothing outside that folder can be printed); name is shown in the print queue.
 * The call resolves once the print dialog is open.
 */
@CapacitorPlugin(name = "PdfPrint")
public class PdfPrintPlugin extends Plugin {

    @PluginMethod
    public void print(PluginCall call) {
        String path = call.getString("path", "");
        String name = call.getString("name", "report.pdf");
        if (name == null || name.isEmpty()) name = "report.pdf";
        if (name.length() > 80) name = name.substring(0, 80);

        File file;
        try {
            File exports = new File(getContext().getCacheDir(), "exports").getCanonicalFile();
            file = new File(getContext().getCacheDir(), path == null ? "" : path).getCanonicalFile();
            if (!file.getPath().startsWith(exports.getPath() + File.separator) || !file.getName().toLowerCase().endsWith(".pdf")) {
                call.reject("Only a report the app made can be printed", "BAD_PATH");
                return;
            }
        } catch (IOException e) {
            call.reject("Only a report the app made can be printed", "BAD_PATH");
            return;
        }
        if (!file.isFile()) {
            call.reject("The report file is missing", "NOT_FOUND");
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("The app is not open", "NO_ACTIVITY");
            return;
        }
        final File pdf = file;
        final String jobName = name.toLowerCase().endsWith(".pdf") ? name.substring(0, name.length() - 4) : name;
        final String docName = jobName + ".pdf";
        activity.runOnUiThread(() -> {
            try {
                PrintManager pm = (PrintManager) activity.getSystemService(Context.PRINT_SERVICE);
                if (pm == null) {
                    call.reject("Printing is not available on this phone", "UNAVAILABLE");
                    return;
                }
                pm.print(jobName, new FileAdapter(pdf, docName), null);
                call.resolve();
            } catch (Exception e) {
                call.reject("Could not open the print dialog: " + e.getMessage(), "PRINT_FAILED");
            }
        });
    }

    /** hands the finished PDF file to the print framework as it is */
    static class FileAdapter extends PrintDocumentAdapter {

        private final File file;
        private final String docName;

        FileAdapter(File file, String docName) {
            this.file = file;
            this.docName = docName;
        }

        @Override
        public void onLayout(
            PrintAttributes oldAttributes,
            PrintAttributes newAttributes,
            CancellationSignal cancellationSignal,
            LayoutResultCallback callback,
            Bundle extras
        ) {
            if (cancellationSignal.isCanceled()) {
                callback.onLayoutCancelled();
                return;
            }
            PrintDocumentInfo info = new PrintDocumentInfo.Builder(docName)
                .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                .setPageCount(PrintDocumentInfo.PAGE_COUNT_UNKNOWN)
                .build();
            callback.onLayoutFinished(info, true);
        }

        @Override
        public void onWrite(
            PageRange[] pages,
            ParcelFileDescriptor destination,
            CancellationSignal cancellationSignal,
            WriteResultCallback callback
        ) {
            try (InputStream in = new FileInputStream(file); OutputStream out = new FileOutputStream(destination.getFileDescriptor())) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) != -1) {
                    if (cancellationSignal.isCanceled()) {
                        callback.onWriteCancelled();
                        return;
                    }
                    out.write(buf, 0, n);
                }
                callback.onWriteFinished(new PageRange[] { PageRange.ALL_PAGES });
            } catch (Exception e) {
                callback.onWriteFailed(e.getMessage());
            }
        }
    }
}
