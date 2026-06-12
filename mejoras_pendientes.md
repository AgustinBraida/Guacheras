# Mejoras Pendientes

Este archivo contiene la lista de mejoras identificadas en la auditoria. Se pueden marcar o eliminar a medida que se completen.

- [ ] **Renombrar webhook de pagos**
  * **Descripcion:** Cambiar el nombre de [api/webhook_ls.php](file:///c:/Users/agust/Desktop/Guacheras-main/api/webhook_ls.php) a `webhook_mp.php`.
  * **Detalle:** La integracion actual es con Mercado Pago. Cambiar el nombre del archivo evitara confusiones y mantendra el codigo ordenado. Tambien se debe actualizar la URL en el panel de desarrolladores de Mercado Pago.

- [ ] **Mejorar seguridad en la carpeta de subidas**
  * **Descripcion:** Reemplazar el archivo `.htaccess` en la carpeta `uploads/profile_images/` generado por [api/profile_images.php](file:///c:/Users/agust/Desktop/Guacheras-main/api/profile_images.php).
  * **Detalle:** Bloquear explicitamente cualquier script ejecutable usando una regla mas estricta en el `.htaccess`:
    ```apache
    <FilesMatch "\.(php|php3|php4|php5|php7|php8|phtml|pl|py|jsp|asp|sh|cgi)$">
        Order Deny,Allow
        Deny from all
    </FilesMatch>
    ```

- [ ] **Reubicar almacenamiento del Rate Limiting**
  * **Descripcion:** Modificar la ruta de guardado en la funcion `_rl_file` en [api/db_config.php](file:///c:/Users/agust/Desktop/Guacheras-main/api/db_config.php).
  * **Detalle:** Cambiar el uso de `sys_get_temp_dir()` por una ruta privada dentro de la aplicacion que no sea accesible desde la web para prevenir riesgos en hosting compartido.

- [ ] **Optimizar base de datos con indices**
  * **Descripcion:** Agregar un indice compuesto a la tabla de registros en [vetfield_schema.sql](file:///c:/Users/agust/Desktop/Guacheras-main/vetfield_schema.sql).
  * **Detalle:** Ejecutar la consulta SQL:
    ```sql
    ALTER TABLE `registros` ADD INDEX `idx_user_productor` (`user_id`, `productor`);
    ```
    Esto optimizara las consultas filtradas por productor en los reportes y graficos.

- [ ] **Limpieza de archivos obsoletos**
  * **Descripcion:** Eliminar el archivo huerfano [default.php](file:///c:/Users/agust/Desktop/Guacheras-main/default.php) de la raiz.
  * **Detalle:** Corresponde a la pagina por defecto del hosting y ya no es necesario dado que el archivo [.htaccess](file:///c:/Users/agust/Desktop/Guacheras-main/.htaccess) maneja el enrutamiento principal.

- [ ] **Robustecer el parser del archivo .env**
  * **Descripcion:** Adaptar o advertir sobre las limitaciones del lector de entorno en [api/db_config.php](file:///c:/Users/agust/Desktop/Guacheras-main/api/db_config.php).
  * **Detalle:** Asegurar que las variables de configuracion en el archivo `.env` no lleven comillas externas ni comentarios inline para evitar fallos de lectura.
