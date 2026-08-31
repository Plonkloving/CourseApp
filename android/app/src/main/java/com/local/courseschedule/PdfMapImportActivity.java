package com.local.courseschedule;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.pdf.PdfRenderer;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;

public class PdfMapImportActivity extends Activity {
    private ParcelFileDescriptor descriptor;
    private PdfRenderer renderer;
    private CropPageView cropView;
    private TextView pageLabel;
    private EditText nameInput;
    private EditText campusInput;
    private Button previousButton;
    private Button nextButton;
    private int pageIndex;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(23, 59, 87));
        getWindow().setNavigationBarColor(Color.rgb(251, 250, 247));
        try {
            descriptor = getContentResolver().openFileDescriptor(getIntent().getData(), "r");
            if (descriptor == null || descriptor.getStatSize() > 20L * 1024L * 1024L) throw new Exception("PDF 超过 20 MB 或无法读取");
            renderer = new PdfRenderer(descriptor);
            if (renderer.getPageCount() == 0) throw new Exception("PDF 没有可读取的页面");
            buildLayout();
            renderPage(0);
        } catch (Exception error) {
            Toast.makeText(this, "无法打开 PDF：" + safeMessage(error), Toast.LENGTH_LONG).show();
            finish();
        }
    }

    private void buildLayout() {
        int padding = dp(14);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(padding, padding, padding, padding);
        root.setBackgroundColor(Color.rgb(251, 250, 247));

        TextView title = new TextView(this);
        title.setText("从 PDF 提取校区地图");
        title.setTextColor(Color.rgb(24, 48, 65));
        title.setTextSize(21);
        title.setTypeface(null, 1);
        root.addView(title, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView note = new TextView(this);
        note.setText("选择页面并拖动裁剪框，只保存框内地图；整页地图可直接保存。");
        note.setTextColor(Color.rgb(96, 112, 121));
        note.setTextSize(13);
        note.setPadding(0, dp(5), 0, dp(10));
        root.addView(note);

        cropView = new CropPageView(this);
        root.addView(cropView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        LinearLayout pages = horizontalRow();
        previousButton = button("上一页");
        nextButton = button("下一页");
        pageLabel = new TextView(this);
        pageLabel.setGravity(17);
        pageLabel.setTextColor(Color.rgb(24, 48, 65));
        pages.addView(previousButton, new LinearLayout.LayoutParams(0, dp(44), 1));
        pages.addView(pageLabel, new LinearLayout.LayoutParams(0, dp(44), 1));
        pages.addView(nextButton, new LinearLayout.LayoutParams(0, dp(44), 1));
        pages.setPadding(0, dp(8), 0, dp(8));
        root.addView(pages);

        nameInput = input("地图名称", getIntent().getStringExtra("mapName"));
        campusInput = input("所属校区", getIntent().getStringExtra("campus"));
        root.addView(nameInput, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));
        LinearLayout.LayoutParams campusParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
        campusParams.topMargin = dp(7);
        root.addView(campusInput, campusParams);

        LinearLayout actions = horizontalRow();
        Button cancel = button("取消");
        Button save = button("保存地图");
        actions.setPadding(0, dp(10), 0, 0);
        actions.addView(cancel, new LinearLayout.LayoutParams(0, dp(46), 1));
        LinearLayout.LayoutParams saveParams = new LinearLayout.LayoutParams(0, dp(46), 1);
        saveParams.leftMargin = dp(8);
        actions.addView(save, saveParams);
        root.addView(actions);
        setContentView(root);

        previousButton.setOnClickListener(view -> renderPage(pageIndex - 1));
        nextButton.setOnClickListener(view -> renderPage(pageIndex + 1));
        cancel.setOnClickListener(view -> finish());
        save.setOnClickListener(view -> saveSelection(save));
    }

    private void renderPage(int nextIndex) {
        if (nextIndex < 0 || nextIndex >= renderer.getPageCount()) return;
        try (PdfRenderer.Page page = renderer.openPage(nextIndex)) {
            float scale = Math.min(3f, 2400f / Math.max(1, page.getWidth()));
            int width = Math.max(1, Math.round(page.getWidth() * scale));
            int height = Math.max(1, Math.round(page.getHeight() * scale));
            double pixels = (double) width * height;
            if (pixels > 12_000_000d) {
                double reduction = Math.sqrt(12_000_000d / pixels);
                width = Math.max(1, (int) (width * reduction));
                height = Math.max(1, (int) (height * reduction));
                scale *= (float) reduction;
            }
            Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            bitmap.eraseColor(Color.WHITE);
            Matrix matrix = new Matrix();
            matrix.setScale(scale, scale);
            page.render(bitmap, null, matrix, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
            pageIndex = nextIndex;
            cropView.setBitmap(bitmap);
            pageLabel.setText("第 " + (pageIndex + 1) + " / " + renderer.getPageCount() + " 页");
            previousButton.setEnabled(pageIndex > 0);
            nextButton.setEnabled(pageIndex + 1 < renderer.getPageCount());
        } catch (Exception error) {
            Toast.makeText(this, "页面读取失败：" + safeMessage(error), Toast.LENGTH_LONG).show();
        }
    }

    private void saveSelection(Button saveButton) {
        saveButton.setEnabled(false);
        try {
            Bitmap cropped = cropView.createCroppedBitmap();
            File directory = new File(getCacheDir(), "pdf-map-import");
            if (!directory.exists() && !directory.mkdirs()) throw new Exception("无法创建临时目录");
            File output = new File(directory, "map-" + System.nanoTime() + ".png");
            try (FileOutputStream stream = new FileOutputStream(output)) {
                if (!cropped.compress(Bitmap.CompressFormat.PNG, 100, stream)) throw new Exception("地图图片生成失败");
            } finally {
                cropped.recycle();
            }
            Intent result = new Intent();
            result.putExtra("preparedPath", output.getAbsolutePath());
            result.putExtra("mapName", cleanText(nameInput.getText().toString()));
            result.putExtra("campus", cleanText(campusInput.getText().toString()));
            setResult(RESULT_OK, result);
            finish();
        } catch (Exception error) {
            saveButton.setEnabled(true);
            Toast.makeText(this, "保存失败：" + safeMessage(error), Toast.LENGTH_LONG).show();
        }
    }

    private LinearLayout horizontalRow() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        return row;
    }

    private Button button(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        return button;
    }

    private EditText input(String hint, String value) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setSingleLine(true);
        input.setText(value == null ? "" : value);
        input.setTextSize(14);
        return input;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private String cleanText(String value) {
        String clean = value == null ? "" : value.replace('\n', ' ').replace('\r', ' ').trim();
        return clean.length() > 80 ? clean.substring(0, 80) : clean;
    }

    private String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty() ? "操作失败" : message.replace('\n', ' ').replace('\r', ' ');
    }

    @Override
    protected void onDestroy() {
        if (cropView != null) cropView.releaseBitmap();
        cropView = null;
        if (renderer != null) renderer.close();
        if (descriptor != null) {
            try { descriptor.close(); } catch (Exception ignored) {}
        }
        super.onDestroy();
    }

    private static final class CropPageView extends View {
        private static final int MOVE = 1, TOP_LEFT = 2, TOP_RIGHT = 3, BOTTOM_LEFT = 4, BOTTOM_RIGHT = 5;
        private final Paint bitmapPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        private final Paint shadePaint = new Paint();
        private final Paint borderPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF imageRect = new RectF();
        private final RectF cropRect = new RectF();
        private Bitmap bitmap;
        private int mode;
        private float downX, downY;
        private RectF startRect;

        CropPageView(Activity context) {
            super(context);
            setBackgroundColor(Color.rgb(38, 51, 59));
            shadePaint.setColor(0x99000000);
            borderPaint.setColor(Color.WHITE);
            borderPaint.setStyle(Paint.Style.STROKE);
            borderPaint.setStrokeWidth(context.getResources().getDisplayMetrics().density * 2);
        }

        void setBitmap(Bitmap next) {
            if (bitmap != null && bitmap != next) bitmap.recycle();
            bitmap = next;
            resetCrop();
            invalidate();
        }

        void releaseBitmap() {
            if (bitmap != null) bitmap.recycle();
            bitmap = null;
        }

        private void resetCrop() {
            updateImageRect();
            if (!imageRect.isEmpty()) {
                float insetX = imageRect.width() * 0.04f;
                float insetY = imageRect.height() * 0.04f;
                cropRect.set(imageRect.left + insetX, imageRect.top + insetY, imageRect.right - insetX, imageRect.bottom - insetY);
            }
        }

        private void updateImageRect() {
            if (bitmap == null || getWidth() == 0 || getHeight() == 0) return;
            float scale = Math.min((float) getWidth() / bitmap.getWidth(), (float) getHeight() / bitmap.getHeight());
            float width = bitmap.getWidth() * scale;
            float height = bitmap.getHeight() * scale;
            imageRect.set((getWidth() - width) / 2f, (getHeight() - height) / 2f,
                    (getWidth() + width) / 2f, (getHeight() + height) / 2f);
        }

        @Override
        protected void onSizeChanged(int width, int height, int oldWidth, int oldHeight) {
            super.onSizeChanged(width, height, oldWidth, oldHeight);
            resetCrop();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            if (bitmap == null) return;
            updateImageRect();
            canvas.drawBitmap(bitmap, null, imageRect, bitmapPaint);
            canvas.drawRect(imageRect.left, imageRect.top, imageRect.right, cropRect.top, shadePaint);
            canvas.drawRect(imageRect.left, cropRect.bottom, imageRect.right, imageRect.bottom, shadePaint);
            canvas.drawRect(imageRect.left, cropRect.top, cropRect.left, cropRect.bottom, shadePaint);
            canvas.drawRect(cropRect.right, cropRect.top, imageRect.right, cropRect.bottom, shadePaint);
            canvas.drawRect(cropRect, borderPaint);
            float radius = getResources().getDisplayMetrics().density * 7;
            Paint handles = new Paint(Paint.ANTI_ALIAS_FLAG);
            handles.setColor(Color.WHITE);
            canvas.drawCircle(cropRect.left, cropRect.top, radius, handles);
            canvas.drawCircle(cropRect.right, cropRect.top, radius, handles);
            canvas.drawCircle(cropRect.left, cropRect.bottom, radius, handles);
            canvas.drawCircle(cropRect.right, cropRect.bottom, radius, handles);
        }

        @Override
        public boolean onTouchEvent(MotionEvent event) {
            if (bitmap == null) return false;
            float x = event.getX(), y = event.getY();
            if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                mode = hitMode(x, y);
                if (mode == 0) return false;
                downX = x;
                downY = y;
                startRect = new RectF(cropRect);
                return true;
            }
            if (event.getActionMasked() == MotionEvent.ACTION_MOVE && mode != 0) {
                float dx = x - downX, dy = y - downY;
                float min = getResources().getDisplayMetrics().density * 72;
                if (mode == MOVE) {
                    float moveX = Math.max(imageRect.left - startRect.left, Math.min(dx, imageRect.right - startRect.right));
                    float moveY = Math.max(imageRect.top - startRect.top, Math.min(dy, imageRect.bottom - startRect.bottom));
                    cropRect.set(startRect);
                    cropRect.offset(moveX, moveY);
                } else {
                    float left = startRect.left, top = startRect.top, right = startRect.right, bottom = startRect.bottom;
                    if (mode == TOP_LEFT || mode == BOTTOM_LEFT) left = Math.max(imageRect.left, Math.min(startRect.left + dx, right - min));
                    if (mode == TOP_RIGHT || mode == BOTTOM_RIGHT) right = Math.min(imageRect.right, Math.max(startRect.right + dx, left + min));
                    if (mode == TOP_LEFT || mode == TOP_RIGHT) top = Math.max(imageRect.top, Math.min(startRect.top + dy, bottom - min));
                    if (mode == BOTTOM_LEFT || mode == BOTTOM_RIGHT) bottom = Math.min(imageRect.bottom, Math.max(startRect.bottom + dy, top + min));
                    cropRect.set(left, top, right, bottom);
                }
                invalidate();
                return true;
            }
            if (event.getActionMasked() == MotionEvent.ACTION_UP || event.getActionMasked() == MotionEvent.ACTION_CANCEL) {
                mode = 0;
                return true;
            }
            return true;
        }

        private int hitMode(float x, float y) {
            float hit = getResources().getDisplayMetrics().density * 32;
            if (distance(x, y, cropRect.left, cropRect.top) < hit) return TOP_LEFT;
            if (distance(x, y, cropRect.right, cropRect.top) < hit) return TOP_RIGHT;
            if (distance(x, y, cropRect.left, cropRect.bottom) < hit) return BOTTOM_LEFT;
            if (distance(x, y, cropRect.right, cropRect.bottom) < hit) return BOTTOM_RIGHT;
            return cropRect.contains(x, y) ? MOVE : 0;
        }

        private float distance(float x1, float y1, float x2, float y2) {
            return (float) Math.hypot(x2 - x1, y2 - y1);
        }

        Bitmap createCroppedBitmap() throws Exception {
            if (bitmap == null || imageRect.isEmpty() || cropRect.isEmpty()) throw new Exception("没有可保存的地图区域");
            int left = Math.max(0, Math.round((cropRect.left - imageRect.left) / imageRect.width() * bitmap.getWidth()));
            int top = Math.max(0, Math.round((cropRect.top - imageRect.top) / imageRect.height() * bitmap.getHeight()));
            int right = Math.min(bitmap.getWidth(), Math.round((cropRect.right - imageRect.left) / imageRect.width() * bitmap.getWidth()));
            int bottom = Math.min(bitmap.getHeight(), Math.round((cropRect.bottom - imageRect.top) / imageRect.height() * bitmap.getHeight()));
            if (right - left < 2 || bottom - top < 2) throw new Exception("裁剪区域过小");
            return Bitmap.createBitmap(bitmap, left, top, right - left, bottom - top);
        }
    }
}
