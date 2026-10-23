package com.m3athrazaq.asfari;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // the app's own plugins: reading the Excel backup the user picks or opens with the app,
        // printing the PDF report, and keeping the WebView on the app's own pages
        registerPlugin(XlsxImportPlugin.class);
        registerPlugin(PdfPrintPlugin.class);
        registerPlugin(NavigationGuardPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
