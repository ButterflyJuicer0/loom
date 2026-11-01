package cloud.loom.node;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Serves the downloaded update APK to the system package-installer as a
 * content:// URI. A minimal FileProvider (no androidx dependency): the installer
 * runs as a different uid and SELinux won't let it read our app-private files by
 * path, but it CAN read them through this provider when we start the install
 * intent with FLAG_GRANT_READ_URI_PERMISSION. The provider only ever exposes the
 * one fixed file {@code filesDir/update.apk}.
 */
public class ApkProvider extends ContentProvider {

    static final String AUTHORITY = "cloud.loom.node.apk";
    static final String APK_NAME = "update.apk";

    static Uri uri() { return Uri.parse("content://" + AUTHORITY + "/" + APK_NAME); }

    private File apk() { return new File(getContext().getFilesDir(), APK_NAME); }

    @Override public boolean onCreate() { return true; }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        return ParcelFileDescriptor.open(apk(), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection,
                                  String[] selectionArgs, String sortOrder) {
        String[] cols = projection != null ? projection
                : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = APK_NAME;
            else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = apk().length();
            else row[i] = null;
        }
        MatrixCursor c = new MatrixCursor(cols, 1);
        c.addRow(row);
        return c;
    }

    @Override public String getType(Uri uri) { return "application/vnd.android.package-archive"; }

    @Override public Uri insert(Uri uri, ContentValues values) { return null; }
    @Override public int delete(Uri uri, String s, String[] a) { return 0; }
    @Override public int update(Uri uri, ContentValues v, String s, String[] a) { return 0; }
}
