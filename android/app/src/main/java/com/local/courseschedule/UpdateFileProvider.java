package com.local.courseschedule;

import androidx.core.content.FileProvider;

public final class UpdateFileProvider extends FileProvider {
    public UpdateFileProvider() {
        super(R.xml.update_paths);
    }
}
