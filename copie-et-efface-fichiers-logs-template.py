"""
# Je n'en croyais pas mes yeux lorsque je suis allé chez un client l'année dernière et que j'ai dû ouvrir un ticket pour lui expliquer la nécessité des scripts de nettoyage de fichiers.
# Si un administrateur système ne peut pas faire cela, il faut se demander ce qu'il fait ; c'est la tâche la plus élémentaire et essentielle.
# Chaque jour, des centaines d'heures sont consacrées à des tickets sur ce sujet et à des incidents opérationnels. Il faut que cela cesse !
#
# Voici mon cadeau au monde informatique : un script Python gratuit et modifiable.
# Cheers! - Fernando Cabal - 2 avril 2025
"""
import os
import shutil
import gzip
import time
import logging
import sys

def configure_logging(log_file_path):
    """
    Configure la journalisation pour écrire dans un fichier journal spécifié.

    Args:
        log_file_path (str): Le chemin d'accès au fichier journal.
    """
    # Créer le répertoire s'il n'existe pas
    log_dir = os.path.dirname(log_file_path)
    if log_dir and not os.path.exists(log_dir):
        os.makedirs(log_dir)

    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler(log_file_path),
            logging.StreamHandler(sys.stdout)  # Aussi journaliser sur la console
        ]
    )

def get_file_size_mb(file_path):
    """
    Obtient la taille d'un fichier en mégaoctets.

    Args:
        file_path (str): Le chemin d'accès au fichier.

    Returns:
        float: La taille du fichier en mégaoctets, ou 0 si le fichier n'existe pas ou si une erreur se produit.
    """
    try:
        if os.path.exists(file_path):
            return os.path.getsize(file_path) / (1024 * 1024)  # Convertir les octets en MB
        else:
            logging.warning(f"Fichier non trouvé : {file_path}")
            return 0
    except Exception as e:
        logging.error(f"Erreur lors de l'obtention de la taille du fichier pour {file_path} : {e}")
        return 0

def compress_file(input_file, output_file):
    """
    Compresse un fichier en utilisant gzip.

    Args:
        input_file (str): Le chemin d'accès au fichier d'entrée.
        output_file (str): Le chemin d'accès au fichier de sortie (compressé).
    """
    try:
        with open(input_file, 'rb') as infile, gzip.open(output_file, 'wb') as outfile:
            shutil.copyfileobj(infile, outfile)
        logging.info(f"Fichier compressé avec succès : {input_file} vers {output_file}")
        return True
    except Exception as e:
        logging.error(f"Erreur lors de la compression du fichier {input_file} : {e}")
        return False

def copy_file(src_file, dest_file):
    """
    Copie un fichier de la source vers la destination.

    Args:
        src_file (str): Chemin d'accès au fichier source.
        dest_file (str): Chemin d'accès au fichier de destination.
    """
    try:
        # Assurer que le répertoire de destination existe
        dest_dir = os.path.dirname(dest_file)
        if dest_dir and not os.path.exists(dest_dir):
            os.makedirs(dest_dir)
        shutil.copy2(src_file, dest_file)  # Copier avec les métadonnées
        logging.info(f"Fichier copié avec succès : {src_file} vers {dest_file}")
        return True
    except Exception as e:
        logging.error(f"Erreur lors de la copie du fichier {src_file} vers {dest_file} : {e}")
        return False

def delete_file(file_path):
    """
    Supprime un fichier.

    Args:
        file_path (str): Le chemin d'accès au fichier à supprimer.
    """
    try:
        os.remove(file_path)
        logging.info(f"Fichier supprimé avec succès : {file_path}")
        return True
    except Exception as e:
        logging.error(f"Erreur lors de la suppression du fichier {file_path} : {e}")
        return False

def process_log_files(dir1, dir2, log_file_path):
    """
    Traite les fichiers journaux dans dir1 qui sont plus grands que 500MB, les copie dans dir2,
    compresse la copie, et supprime l'original dans dir1.

    Args:
        dir1 (str): Le chemin d'accès au répertoire source.
        dir2 (str): Le chemin d'accès au répertoire de destination.
        log_file_path (str): Chemin d'accès au fichier journal.
    """
    configure_logging(log_file_path)
    logging.info(f"Début du traitement des fichiers journaux de {dir1} vers {dir2}")

    if not os.path.exists(dir1):
        logging.error(f"Le répertoire source n'existe pas : {dir1}")
        return
    if not os.path.exists(dir2):
        logging.error(f"Le répertoire de destination n'existe pas : {dir2}")
        return

    for filename in os.listdir(dir1):
        src_file = os.path.join(dir1, filename)
        if not os.path.isfile(src_file):
            continue  # Ignorer les répertoires et les non-fichiers

        file_size_mb = get_file_size_mb(src_file)
        if file_size_mb > 500:
            logging.info(f"Fichier volumineux trouvé : {src_file} ({file_size_mb:.2f} MB)")

            # Créer un nom de fichier de destination
            dest_file = os.path.join(dir2, filename)
            compressed_file = dest_file + '.gz'

            # Copier le fichier
            copy_success = copy_file(src_file, dest_file)

            if copy_success:
                # Compresser le fichier copié
                compress_success = compress_file(dest_file, compressed_file)
                if compress_success:
                    # Supprimer le fichier original
                    delete_success = delete_file(dest_file)
                    if delete_success:
                        logging.info(f"Fichier traité avec succès : {src_file}")
                    else:
                        logging.error(f"Échec de la suppression du fichier original : {dest_file}")
                else:
                    logging.error(f"Échec de la compression du fichier : {dest_file}")
            else:
                logging.error(f"Échec de la copie du fichier : {src_file}")
        else:
            logging.info(f"Fichier ignoré : {src_file} ({file_size_mb:.2f} MB) - La taille n'est pas supérieure à 500MB")

    logging.info("Traitement des fichiers journaux terminé.")

if __name__ == "__main__":
    # Exemple d'utilisation :
    source_directory = '/path/to/your/log/files'  # Remplacez par votre chemin d'accès réel au répertoire source
    destination_directory = '/path/to/your/backup/logs'  # Remplacez par votre chemin d'accès réel au répertoire de destination
    log_file = '/path/to/your/log_rotation.log'  # Remplacez par le chemin d'accès souhaité à votre fichier journal
    process_log_files(source_directory, destination_directory, log_file)
